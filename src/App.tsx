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

export default function App() {
  const [items, setItems] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(isConfigured)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Reminder | null>(null)
  const [form, setForm] = useState<ReminderInput>(emptyForm)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [showCompleted, setShowCompleted] = useState(true)

  const load = useCallback(async () => {
    if (!supabase) return
    const { data, error: queryError } = await supabase.from('reminders').select('*').order('due_date').order('due_time', { nullsFirst: false })
    if (queryError) setError('予定を読み込めませんでした。少し待って再度お試しください。')
    else { setItems(data ?? []); setError('') }
    setLoading(false)
  }, [])

  useEffect(() => {
    const client = supabase
    if (!client) return
    let active = true
    const connect = async () => {
      const { data } = await client.auth.getSession()
      if (!data.session) {
        const { error: authError } = await client.auth.signInAnonymously()
        if (authError) { if (active) { setError('接続できませんでした。Supabaseの匿名ログイン設定をご確認ください。'); setLoading(false) }; return }
      }
      if (!active) return
      await load()
    }
    void connect()
    const channel = client.channel('shared-reminders').on('postgres_changes', { event: '*', schema: 'public', table: 'reminders' }, () => void load()).subscribe()
    return () => { active = false; void client.removeChannel(channel) }
  }, [load])

  const groups = useMemo(() => {
    const visible = items.filter(item => showCompleted || !item.is_completed)
    return visible.reduce<Record<string, Reminder[]>>((all, item) => ((all[item.due_date] ??= []).push(item), all), {})
  }, [items, showCompleted])
  const pending = items.filter(item => !item.is_completed).length

  const openNew = () => { setEditing(null); setForm(emptyForm()); setSheetOpen(true) }
  const openEdit = (item: Reminder) => { setEditing(item); setForm({ title: item.title, due_date: item.due_date, due_time: item.due_time ?? '', note: item.note ?? '' }); setSheetOpen(true) }
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!supabase || !form.title.trim()) return
    const payload = { ...form, title: form.title.trim(), due_time: form.due_time || null, note: form.note?.trim() || null }
    const result = editing ? await supabase.from('reminders').update(payload).eq('id', editing.id) : await supabase.from('reminders').insert(payload)
    if (result.error) setError('保存できませんでした。もう一度お試しください。')
    else { setSheetOpen(false); await load() }
  }
  const toggle = async (item: Reminder) => { if (supabase) { const { error } = await supabase.from('reminders').update({ is_completed: !item.is_completed }).eq('id', item.id); if (error) setError('更新できませんでした。') } }
  const remove = async () => {
    if (!supabase || !editing || !confirm(`「${editing.title}」を削除しますか？`)) return
    const { error: deleteError } = await supabase.from('reminders').delete().eq('id', editing.id)
    if (deleteError) setError('削除できませんでした。'); else { setSheetOpen(false); await load() }
  }

  return <main>
    <header><div><p className="eyebrow">OUR REMINDERS</p><h1>ふたりの予定</h1><p className="summary">未完了の予定が <strong>{pending}件</strong> あります</p></div><div className="avatar" aria-label="共有中">ふたり</div></header>
    {!isConfigured && <section className="setup"><span>🌱</span><div><strong>あと少しで準備完了です</strong><p>READMEの手順でSupabaseを接続すると、ふたりの予定がここに表示されます。</p></div></section>}
    {error && <div className="error" role="alert">{error}<button onClick={() => void load()}>再読み込み</button></div>}
    <div className="toolbar"><h2>予定一覧</h2><label><input type="checkbox" checked={showCompleted} onChange={e => setShowCompleted(e.target.checked)} /> 完了済みも表示</label></div>
    {loading ? <div className="empty">読み込んでいます…</div> : Object.keys(groups).length === 0 ? <div className="empty"><span>✓</span><h3>予定はありません</h3><p>右下の＋から、ふたりの予定を追加しましょう。</p></div> :
      Object.entries(groups).map(([date, reminders]) => <section className="day" key={date}><h3 className={date === today() ? 'today' : ''}>{dateLabel(date)} <small>{date.split('-').join('.')}</small></h3><div className="cards">{reminders.map(item => <article className={`card ${item.is_completed ? 'completed' : ''}`} key={item.id}>
        <button className="check" onClick={() => void toggle(item)} aria-label={item.is_completed ? '未完了に戻す' : '完了にする'}>{item.is_completed ? '✓' : ''}</button>
        <button className="cardbody" onClick={() => openEdit(item)}><strong>{item.title}</strong>{(item.due_time || item.note) && <span>{item.due_time?.slice(0, 5)}{item.due_time && item.note ? ' ・ ' : ''}{item.note}</span>}</button><button className="chevron" onClick={() => openEdit(item)} aria-label="編集">›</button>
      </article>)}</div></section>)}
    <button className="fab" onClick={openNew} disabled={!isConfigured} aria-label="新しい予定を追加">＋</button>
    {sheetOpen && <div className="backdrop" onMouseDown={e => e.target === e.currentTarget && setSheetOpen(false)}><section className="sheet" role="dialog" aria-modal="true" aria-labelledby="form-title"><div className="handle"/><div className="sheethead"><button type="button" onClick={() => setSheetOpen(false)}>キャンセル</button><h2 id="form-title">{editing ? '予定を編集' : '新しい予定'}</h2><span /></div>
      <form onSubmit={e => void save(e)}><label>タイトル<input autoFocus required maxLength={100} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="例：クリーニングを受け取る" /></label><div className="row"><label>日付<input required type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></label><label>時刻 <small>任意</small><input type="time" value={form.due_time ?? ''} onChange={e => setForm({ ...form, due_time: e.target.value })} /></label></div><label>メモ <small>任意</small><textarea rows={4} maxLength={1000} value={form.note ?? ''} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="ふたりに分かるメモを追加" /></label><button className="primary" type="submit">{editing ? '変更を保存' : '予定を追加'}</button>{editing && <button className="danger" type="button" onClick={() => void remove()}>この予定を削除</button>}</form>
    </section></div>}
  </main>
}
