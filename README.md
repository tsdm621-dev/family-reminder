# ふたりの予定

夫婦2人で同じ予定を共有する、iPhone向けのシンプルなリマインダーPWAです。画面上のログインやパスワード入力、プッシュ通知はありません。初回だけ2台のiPhoneを一時的な共有コードでペアリングし、その後は各端末のSupabase Anonymous Authセッションを使って自動接続します。

## できること

- 日付・時刻・メモ付きの予定を追加、編集、削除
- 完了／未完了をワンタップで切り替え
- 今日、明日、今後の日付ごとに表示
- Supabase Realtimeで片方の端末の変更をもう片方へ反映
- iPhoneのホーム画面に追加してアプリのように利用
- 共有コードで登録した2台だけが同じ予定へアクセス

## 初回セットアップ

### 1. Supabaseを用意する

1. Supabaseで無料プロジェクトを1つ作ります。
2. **SQL Editor** → **New query** を開きます。
3. このリポジトリの `supabase/schema.sql` を全部コピーして実行します。
4. **Authentication** → **Providers** → **Anonymous Sign-Ins** を有効にします。
5. **Project Settings** → **API** で次の2つを確認します。
   - Project URL
   - Publishable key（または従来の anon public key）

> `service_role` キーは絶対にブラウザへ入れないでください。Publishable/anon keyは公開される前提のキーです。実際のデータ保護は、世帯メンバーだけを許可するRLSで行います。

### 2. GitHub Actionsへ接続情報を登録する

リポジトリの **Settings** → **Secrets and variables** → **Actions** で次のRepository secretを作ります。

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

値はSupabaseで確認したProject URLとPublishable/anon keyです。

### 3. GitHub Pagesへ公開する

`main` へpushするとGitHub ActionsがビルドしてPagesへ公開します。ワークフローはPages未有効のリポジトリでも有効化を試みる設定です。

### 4. 2台をペアリングする

1. 1台目のiPhoneで公開URLをSafariから開き、**このiPhoneから始める** を押します。
2. 12文字の共有コードが表示されます。コードは15分間・1回だけ有効です。
3. 2台目のiPhoneで同じ公開URLを開き、共有コードを入力します。
4. 以後は2台が同じ「世帯」に所属し、その世帯の予定だけを読み書きできます。
5. 必要なら画面右上の **ふたり** から新しい共有コードを発行できます。すでに2台接続済みの場合は追加できません。

匿名セッションの保存データをSafariから消した場合、その端末は別ユーザーとして扱われます。その場合は、もう1台の端末から新しい共有コードを発行して再ペアリングしてください。

### 5. ホーム画面へ追加する

Safariで公開URLを開き、共有ボタン → **ホーム画面に追加** → **追加** を押します。2台とも同じ公開URLを追加します。

## ローカル開発

```bash
npm install
cp .env.example .env.local
npm run dev
```

`.env.local` にSupabaseのProject URLとPublishable/anon keyを設定します。

## 開発コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバーを起動 |
| `npm run build` | 型チェックと本番ビルド |
| `npm run lint` | ESLintでコードを確認 |
| `npm run preview` | ビルド結果をローカル確認 |

## セキュリティ

- 各予定は `household_id` に所属します。
- RLSは現在の匿名ユーザーが所属する世帯の行だけを許可します。
- 共有コードはDBへ平文保存せずハッシュ化し、15分で期限切れ、使用後は再利用不可です。
- 1ユーザーは1世帯、1世帯は最大2ユーザーです。
- URLやPublishable/anon keyを知っているだけでは既存の予定へアクセスできません。
- 本アプリはプッシュ通知を使用しません。
