-- Supabase Dashboard の SQL Editor に、このファイル全体を貼り付けて実行します。
create extension if not exists pgcrypto;

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 100),
  due_date date not null,
  due_time time,
  note text check (char_length(note) <= 1000),
  is_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reminders enable row level security;

-- この専用プロジェクトで匿名ログイン済みの利用者だけが、共通の予定を操作できます。
-- ご夫婦専用のSupabaseプロジェクトとして使い、URLを第三者に共有しないでください。
create policy "anonymous couple can read reminders" on public.reminders for select to authenticated using (true);
create policy "anonymous couple can add reminders" on public.reminders for insert to authenticated with check (true);
create policy "anonymous couple can update reminders" on public.reminders for update to authenticated using (true) with check (true);
create policy "anonymous couple can delete reminders" on public.reminders for delete to authenticated using (true);

create or replace function public.set_updated_at() returns trigger language plpgsql security invoker set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists reminders_set_updated_at on public.reminders;
create trigger reminders_set_updated_at before update on public.reminders for each row execute function public.set_updated_at();

-- Realtime publicationへ追加（すでに追加済みの場合は何もしません）。
do $$ begin
  alter publication supabase_realtime add table public.reminders;
exception when duplicate_object then null;
end $$;
