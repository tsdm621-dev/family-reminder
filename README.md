# ふたりの予定

夫婦2人で同じ予定を共有する、iPhone向けのシンプルなリマインダーPWAです。ログイン画面やプッシュ通知はなく、初回起動時に裏側でSupabase Anonymous Authへ接続します。React + TypeScript + Vite、Supabase無料枠、GitHub Pagesのすべて無料の構成です。

## できること

- 日付・時刻・メモ付きの予定を追加、編集、削除
- 完了／未完了をワンタップで切り替え
- 今日、明日、今後の日付ごとに表示。完了済みは一目で分かる表示
- Supabase Realtimeで、片方の端末での変更をもう片方へ自動反映
- iPhoneのホーム画面に追加でき、オフライン時にはアプリ画面を起動可能（予定の更新には通信が必要）

## 初回セットアップ（初心者向け）

### 1. Supabaseを用意する

1. [Supabase](https://supabase.com/)で無料アカウントを作り、**New project** からご夫婦専用のプロジェクトを1つ作ります。
2. 左メニューの **SQL Editor** → **New query** を開きます。
3. このリポジトリの [`supabase/schema.sql`](supabase/schema.sql) を全部コピーして貼り、**Run** を押します。テーブル、RLS、Realtime設定が作られます。
4. **Authentication** → **Providers** → **Anonymous Sign-Ins** を有効にします。これにより画面でログインせず利用できます。
5. **Project Settings** → **API** で次の2つを控えます。
   - Project URL
   - Publishable key（表示がない場合は従来の `anon public` key）

> `service_role` キーは絶対に使わないでください。ブラウザ用のPublishable/anon keyは公開される前提のキーで、アクセス制御はSQLのRLSが担います。この構成では、そのSupabaseプロジェクトで匿名認証された利用者全員が同じデータを共有します。プロジェクトと公開URLは夫婦専用にし、第三者へURLを共有しないでください。

### 2. 手元で動かす

Node.js 20以上をインストールして、以下を実行します。

```bash
npm install
cp .env.example .env.local
```

`.env.local` をテキストエディタで開き、手順1で控えた値に置き換えます。

```env
VITE_SUPABASE_URL=https://あなたのプロジェクトID.supabase.co
VITE_SUPABASE_ANON_KEY=あなたのPublishableまたはanonキー
```

次に `npm run dev` を実行し、表示されたURLをブラウザで開きます。`.env.local` はGit管理対象外なので、秘密情報を誤ってコミットしません。

### 3. GitHub Pagesへ自動公開する

1. GitHubのリポジトリ画面で **Settings** → **Secrets and variables** → **Actions** を開きます。
2. **New repository secret** から、`VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` の2つを登録します。
3. **Settings** → **Pages** → **Build and deployment** のSourceで **GitHub Actions** を選びます。
4. `main` ブランチへpushすると、自動でビルド・公開されます。進み具合は **Actions** タブで確認できます。
5. 完了後、Pagesに表示されたURLを夫婦それぞれのiPhoneのSafariで開きます。

### 4. iPhoneのホーム画面へ追加する

1. 必ずSafariで公開URLを開きます。
2. 画面下の共有ボタン（四角から上矢印）をタップします。
3. **ホーム画面に追加** → **追加** をタップします。
4. 以後はホーム画面の「ふたりの予定」アイコンから起動します。2台とも同じ公開URLを追加してください。

## 開発コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバーを起動 |
| `npm run build` | 型チェックと本番ビルド |
| `npm run lint` | ESLintでコードを確認 |
| `npm run preview` | ビルド結果をローカル確認 |

## セキュリティと料金について

- URLやキーはコードに直接書かず、ローカルでは環境ファイル、GitHubではActions Secretsから渡します。
- アプリに埋め込むPublishable/anon key自体は秘密鍵ではありません。データ操作はAnonymous AuthとRLSで制限しています。
- SupabaseとGitHub Pagesの無料枠内なら料金はかかりません。無料枠の上限や休止条件は各サービスの最新案内もご確認ください。
- 本アプリは通知を使用しません。期日はアプリを開いて確認してください。
