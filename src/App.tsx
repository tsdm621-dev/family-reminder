import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { isConfigured, supabase } from './supabase'
import type { Reminder, ReminderInput } from './types'

const today = () => new Date().toLocaleDateString('sv-SE')
const emptyForm = (): ReminderInput => ({ title: '', due_date: today(), due_time: '', note: '' })
const dateLabel = (date: string) => {
  if (date === today()) return '今日'
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
  if (date === tomorrow.toLocaleDateString('sv-SE')) return '明日'
  return new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${date}T00:00:00`))
}
const prettyCode = (code: string) => code.length === 12 ? `${code.slice(0, 6)}-${code.slice(6)}` : code
const pairingError = (message: string) => {
  if (message.includes('invalid_or_expired_code')) return '共有コードが違うか、有効期限が切れています。新しいコードを発行してください。'
  if (message.includes('household_full')) return 'すでに2台のiPhoneが接続済みです。'
  if (message.includes('authentication_required')) return '接続の準備に失敗しました。ページを再読み込みしてください。'
  return '共有設定を完了できませんでした。もう一度お試しください。'
}

export default function App() {
  const [items, setItems] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(isConfigured)
  const [authReady, setAuthReady] = useState(!isConfigured)
  const [householdId, setHouseholdId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Reminder | null>(null)
  const [form, setForm] = useState<ReminderInput>(emptyForm)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [showCompleted, setShowCompleted] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pairingBusy, setPairingBusy] = useState(false)
  const [pairingOpen, setPairingOpen] = useState(false)
  const [pairCode, setPairCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [pairingStatus, setPairingStatus] = useState('')

  const load = useCallback(async () => {
    if (!supabase || !householdId) return
    const { data, error: queryError } = await supabase
      .from('reminders')
      .select('*')
      .eq('household_id', householdId)
      .order('due_date')
      .order('due_time', { nullsFirst: false })
    if (queryError) setError('予定を読み込めませんでした。少し待って再度お試しください。')
    else { setItems(data ?? []); setError('') }
    setLoading(false)
  }, [householdId])

  useEffect(() => {
    const client = supabase
    if (!client) return
    let active = true

    const connect = async () => {
      setLoading(true)
      const { data: current, error: sessionError } = await client.auth.getSession()
      if (sessionError) {
        if (active) { setError('接続情報を確認できませんでした。'); setLoading(false); setAuthReady(true) }
        return
      }

      let session = current.session
      if (!session) {
        const { data: signedIn, error: authError } = await client.auth.signInAnonymously()
        if (authError || !signedIn.session) {
          if (active) { setError('接続できませんでした。Supabaseの匿名ログイン設定をご確認ください。'); setLoading(false); setAuthReady(true) }
          return
        }
        session = signedIn.session
      }

      if (!session || !active) return
      const { data: household, error: householdError } = await client.rpc('get_my_household')
      if (!active) return
      if (householdError) setError('共有設定を確認できませんでした。SupabaseのSQL設定をご確認ください。')
      const id = typeof household === 'string' ? household : null
      setHouseholdId(id)
      setAuthReady(true)
      setLoading(Boolean(id))
    }

    void connect()
    return () => { active = false }
  }, [])

  useEffect(() => {
    const client = supabase
    if (!client || !householdId) return
    setLoading(true)
    void load()
    const channel = client
      .channel(`shared-reminders-${householdId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'reminders',
        filter: `household_id=eq.${householdId}`,
      }, () => void load())
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [householdId, load])

  const createPairingCode = async () => {
    if (!supabase || pairingBusy) return
    setPairingBusy(true)
    setPairingStatus('')
    try {
      const { data, error: codeError } = await supabase.rpc('create_pairing_code')
      if (codeError) {
        setPairCode('')
        setPairingStatus(pairingError(codeError.message))
        return
      }
      const code = typeof data === 'string' ? data.toUpperCase() : ''
      setPairCode(code)
      setPairingStatus(code ? 'このコードをもう1台のiPhoneに入力してください。15分間・1回だけ使えます。' : '')
    } finally {
      setPairingBusy(false)
    }
  }

  const startHousehold = async () => {
    if (!supabase || pairingBusy) return
    setPairingBusy(true)
    setPairingStatus('')
    try {
      const { data, error: createError } = await supabase.rpc('create_household')
      if (createError || typeof data !== 'string') {
        setError(pairingError(createError?.message ?? ''))
        return
      }
      setHouseholdId(data)
      setPairingOpen(true)

      const { data: code, error: codeError } = await supabase.rpc('create_pairing_code')
      if (codeError) setPairingStatus(pairingError(codeError.message))
      else if (typeof code === 'string') {
        setPairCode(code.toUpperCase())
        setPairingStatus('このコードをもう1台のiPhoneに入力してください。15分間・1回だけ使えます。')
      }
    } finally {
      setPairingBusy(false)
    }
  }

  const joinHousehold = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || pairingBusy) return
    const normalized = joinCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
    if (normalized.length !== 12) {
      setPairingStatus('共有コードは12文字です。')
      return
    }

    setPairingBusy(true)
    setPairingStatus('')
    try {
      const { data, error: joinError } = await supabase.rpc('join_household', { p_code: normalized })
      if (joinError || typeof data !== 'string') {
        setPairingStatus(pairingError(joinError?.message ?? ''))
        return
      }
      setHouseholdId(data)
      setJoinCode('')
      setPairingOpen(false)
      setPairingStatus('')
    } finally {
      setPairingBusy(false)
    }
  }

  const groups = useMemo(() => {
    const visible = items.filter(item => showCompleted || !item.is_completed)
    return visible.reduce<Record<string, Reminder[]>>((all, item) => ((all[item.due_date] ??= []).push(item), all), {})
  }, [items, showCompleted])
  const pending = items.filter(item => !item.is_completed).length

  const openNew = () => { setEditing(null); setForm(emptyForm()); setSheetOpen(true) }
  const openEdit = (item: Reminder) => { setEditing(item); setForm({ title: item.title, due_date: item.due_date, due_time: item.due_time ?? '', note: item.note ?? '' }); setSheetOpen(true) }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !householdId || !form.title.trim() || saving) return
    setSaving(true)
    try {
      const payload = {
        ...form,
        household_id: householdId,
        title: form.title.trim(),
        due_time: form.due_time || null,
        note: form.note?.trim() || null,
      }
      const result = editing
        ? await supabase.from('reminders').update(payload).eq('id', editing.id).eq('household_id', householdId)
        : await supabase.from('reminders').insert(payload)
      if (result.error) setError('保存できませんでした。もう一度お試しください。')
      else { setSheetOpen(false); await load() }
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (item: Reminder) => {
    if (!supabase || !householdId) return
    const next = !item.is_completed
    setItems(current => current.map(row => row.id === item.id ? { ...row, is_completed: next } : row))
    const { error: toggleError } = await supabase
      .from('reminders')
      .update({ is_completed: next })
      .eq('id', item.id)
      .eq('household_id', householdId)
    if (toggleError) {
      setItems(current => current.map(row => row.id === item.id ? { ...row, is_completed: item.is_completed } : row))
      setError('更新できませんでした。')
    } else {
      await load()
    }
  }

  const remove = async () => {
    if (!supabase || !householdId || !editing || !confirm(`「${editing.title}」を削除しますか？`)) return
    const { error: deleteError } = await supabase
      .from('reminders')
      .delete()
      .eq('id', editing.id)
      .eq('household_id', householdId)
    if (deleteError) setError('削除できませんでした。')
    else { setSheetOpen(false); await load() }
  }

  if (!isConfigured) {
    return <main>
      <header><div><p className="eyebrow">OUR REMINDERS</p><h1>ふたりの予定</h1></div></header>
      <section className="setup"><span>🌱</span><div><strong>あと少しで準備完了です</strong><p>READMEの手順でSupabaseを接続すると、ふたりの予定を共有できます。</p></div></section>
    </main>
  }

  if (!authReady || (loading && !householdId)) {
    return <main><div className="empty">接続の準備をしています…</div></main>
  }

  if (!householdId) {
    return <main>
      <header><div><p className="eyebrow">OUR REMINDERS</p><h1>ふたりの予定</h1><p className="summary">ログイン画面なしで、2台だけを安全にペアリングします</p></div></header>
      {error && <div className="error" role="alert">{error}</div>}
      <section className="pairing">
        <h2>最初の1台ですか？</h2>
        <p>まずこのiPhoneで共有スペースを作り、表示されたコードをもう1台へ入力します。</p>
        <button className="primary" type="button" disabled={pairingBusy} onClick={() => void startHousehold()}>
          {pairingBusy ? '準備中…' : 'このiPhoneから始める'}
        </button>
        <div className="divider"><span>または</span></div>
        <h2>もう1台から参加</h2>
        <form className="pair-form" onSubmit={e => void joinHousehold(e)}>
          <label>共有コード
            <input value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} placeholder="ABCDEF-123456" autoCapitalize="characters" autoCorrect="off" />
          </label>
          <button className="secondary" type="submit" disabled={pairingBusy}>同じ予定に参加する</button>
        </form>
        {pairingStatus && <p className="status">{pairingStatus}</p>}
      </section>
    </main>
  }

  return <main>
    <header><div><p className="eyebrow">OUR REMINDERS</p><h1>ふたりの予定</h1><p className="summary">未完了の予定が <strong>{pending}件</strong> あります</p></div><button className="avatar" type="button" onClick={() => setPairingOpen(value => !value)} aria-label="共有設定">ふたり</button></header>

    {pairingOpen && <section className="pairing compact">
      <h2>夫婦の共有設定</h2>
      <p>もう1台を追加するときだけ、一時的な共有コードを発行します。</p>
      <button className="secondary" type="button" disabled={pairingBusy} onClick={() => void createPairingCode()}>
        {pairingBusy ? '発行中…' : '共有コードを作る'}
      </button>
      {pairCode && <div className="code" aria-label="共有コード">{prettyCode(pairCode)}</div>}
      {pairingStatus && <p className="status">{pairingStatus}</p>}
    </section>}

    {error && <div className="error" role="alert">{error}<button onClick={() => void load()}>再読み込み</button></div>}
    <div className="toolbar"><h2>予定一覧</h2><label><input type="checkbox" checked={showCompleted} onChange={e => setShowCompleted(e.target.checked)} /> 完了済みも表示</label></div>
    {loading ? <div className="empty">読み込んでいます…</div> : Object.keys(groups).length === 0 ? <div className="empty"><span>✓</span><h3>予定はありません</h3><p>右下の＋から、ふたりの予定を追加しましょう。</p></div> :
      Object.entries(groups).map(([date, reminders]) => <section className="day" key={date}><h3 className={date === today() ? 'today' : ''}>{dateLabel(date)} <small>{date.split('-').join('.')}</small></h3><div className="cards">{reminders.map(item => <article className={`card ${item.is_completed ? 'completed' : ''}`} key={item.id}>
        <button className="check" onClick={() => void toggle(item)} aria-label={item.is_completed ? '未完了に戻す' : '完了にする'}>{item.is_completed ? '✓' : ''}</button>
        <button className="cardbody" onClick={() => openEdit(item)}><strong>{item.title}</strong>{(item.due_time || item.note) && <span>{item.due_time?.slice(0, 5)}{item.due_time && item.note ? ' ・ ' : ''}{item.note}</span>}</button><button className="chevron" onClick={() => openEdit(item)} aria-label="編集">›</button>
      </article>)}</div></section>)}
    <button className="fab" onClick={openNew} aria-label="新しい予定を追加">＋</button>
    {sheetOpen && <div className="backdrop" onMouseDown={e => e.target === e.currentTarget && !saving && setSheetOpen(false)}><section className="sheet" role="dialog" aria-modal="true" aria-labelledby="form-title"><div className="handle"/><div className="sheethead"><button type="button" disabled={saving} onClick={() => setSheetOpen(false)}>キャンセル</button><h2 id="form-title">{editing ? '予定を編集' : '新しい予定'}</h2><span /></div>
      <form onSubmit={e => void save(e)}><label>タイトル<input autoFocus required maxLength={100} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="例：クリーニングを受け取る" /></label><div className="row"><label>日付<input required type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></label><label>時刻 <small>任意</small><input type="time" value={form.due_time ?? ''} onChange={e => setForm({ ...form, due_time: e.target.value })} /></label></div><label>メモ <small>任意</small><textarea rows={4} maxLength={1000} value={form.note ?? ''} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="ふたりに分かるメモを追加" /></label><button className="primary" type="submit" disabled={saving}>{saving ? '保存中…' : editing ? '変更を保存' : '予定を追加'}</button>{editing && <button className="danger" type="button" disabled={saving} onClick={() => void remove()}>この予定を削除</button>}</form>
    </section></div>}
  </main>
}
