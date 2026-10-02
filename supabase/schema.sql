-- Supabase Dashboard の SQL Editor に、このファイル全体を貼り付けて実行します。
-- 既存セットアップに対して再実行しても安全なように、IF EXISTS / IF NOT EXISTS を使っています。
create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id)
);

create table if not exists public.pairing_codes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  due_date date not null,
  due_time time,
  note text check (char_length(note) <= 1000),
  is_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 旧スキーマからの更新用。既存の未所属データは見えなくなり、新規データは必ず世帯に所属します。
alter table public.reminders
  add column if not exists household_id uuid references public.households(id) on delete cascade;

create index if not exists reminders_household_due_idx
  on public.reminders (household_id, due_date, due_time);
create index if not exists household_members_user_idx
  on public.household_members (user_id);

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.pairing_codes enable row level security;
alter table public.reminders enable row level security;

-- 現在の匿名ユーザーが所属している世帯を返します。
create or replace function public.get_my_household()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
  select hm.household_id
  from public.household_members hm
  where hm.user_id = auth.uid()
  limit 1
$$;

-- 1台目の端末用。匿名ユーザーに専用世帯を1つ作成します。
create or replace function public.create_household()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_household uuid;
begin
  if v_user is null then
    raise exception 'authentication_required';
  end if;

  select hm.household_id into v_household
  from public.household_members hm
  where hm.user_id = v_user
  limit 1;

  if v_household is not null then
    return v_household;
  end if;

  insert into public.households default values
  returning id into v_household;

  insert into public.household_members (household_id, user_id)
  values (v_household, v_user);

  return v_household;
end;
$$;

-- 2台目を追加するための、15分だけ有効・1回限りの共有コードを発行します。
create or replace function public.create_pairing_code()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_household uuid;
  v_code text;
  v_members integer;
begin
  if v_user is null then
    raise exception 'authentication_required';
  end if;

  select hm.household_id into v_household
  from public.household_members hm
  where hm.user_id = v_user
  limit 1;

  if v_household is null then
    raise exception 'household_required';
  end if;

  select count(*) into v_members
  from public.household_members hm
  where hm.household_id = v_household;

  if v_members >= 2 then
    raise exception 'household_full';
  end if;

  delete from public.pairing_codes
  where household_id = v_household
    and used_at is null;

  loop
    v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 12));
    begin
      insert into public.pairing_codes (household_id, code_hash, expires_at, created_by)
      values (
        v_household,
        encode(digest(lower(v_code), 'sha256'), 'hex'),
        now() + interval '15 minutes',
        v_user
      );
      return v_code;
    exception when unique_violation then
      null;
    end;
  end loop;
end;
$$;

-- 2台目の端末用。共有コードが正しい場合だけ同じ世帯へ参加させます。
create or replace function public.join_household(p_code text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_household uuid;
  v_code_id uuid;
  v_members integer;
  v_hash text;
begin
  if v_user is null then
    raise exception 'authentication_required';
  end if;

  select hm.household_id into v_household
  from public.household_members hm
  where hm.user_id = v_user
  limit 1;

  if v_household is not null then
    return v_household;
  end if;

  v_hash := encode(
    digest(
      lower(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g')),
      'sha256'
    ),
    'hex'
  );

  select pc.id, pc.household_id
    into v_code_id, v_household
  from public.pairing_codes pc
  where pc.code_hash = v_hash
    and pc.used_at is null
    and pc.expires_at > now()
  for update;

  if v_code_id is null then
    raise exception 'invalid_or_expired_code';
  end if;

  perform 1 from public.households h
  where h.id = v_household
  for update;

  select count(*) into v_members
  from public.household_members hm
  where hm.household_id = v_household;

  if v_members >= 2 then
    raise exception 'household_full';
  end if;

  insert into public.household_members (household_id, user_id)
  values (v_household, v_user);

  update public.pairing_codes
  set used_at = now()
  where id = v_code_id;

  return v_household;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists reminders_set_updated_at on public.reminders;
create trigger reminders_set_updated_at
before update on public.reminders
for each row execute function public.set_updated_at();

-- 古い無条件ポリシーを削除します。
drop policy if exists "anonymous couple can read reminders" on public.reminders;
drop policy if exists "anonymous couple can add reminders" on public.reminders;
drop policy if exists "anonymous couple can update reminders" on public.reminders;
drop policy if exists "anonymous couple can delete reminders" on public.reminders;

drop policy if exists "members can read reminders" on public.reminders;
drop policy if exists "members can add reminders" on public.reminders;
drop policy if exists "members can update reminders" on public.reminders;
drop policy if exists "members can delete reminders" on public.reminders;
drop policy if exists "members can read household" on public.households;
drop policy if exists "users can read own membership" on public.household_members;

create policy "members can read reminders"
on public.reminders for select to authenticated
using (household_id = public.get_my_household());

create policy "members can add reminders"
on public.reminders for insert to authenticated
with check (household_id = public.get_my_household());

create policy "members can update reminders"
on public.reminders for update to authenticated
using (household_id = public.get_my_household())
with check (household_id = public.get_my_household());

create policy "members can delete reminders"
on public.reminders for delete to authenticated
using (household_id = public.get_my_household());

create policy "members can read household"
on public.households for select to authenticated
using (id = public.get_my_household());

create policy "users can read own membership"
on public.household_members for select to authenticated
using (user_id = auth.uid());

revoke all on public.pairing_codes from anon, authenticated;
grant select on public.households, public.household_members, public.reminders to authenticated;
grant insert, update, delete on public.reminders to authenticated;

revoke all on function public.get_my_household() from public;
revoke all on function public.create_household() from public;
revoke all on function public.create_pairing_code() from public;
revoke all on function public.join_household(text) from public;
grant execute on function public.get_my_household() to authenticated;
grant execute on function public.create_household() to authenticated;
grant execute on function public.create_pairing_code() to authenticated;
grant execute on function public.join_household(text) to authenticated;

-- Realtime publicationへ追加（すでに追加済みの場合は何もしません）。
do $$ begin
  alter publication supabase_realtime add table public.reminders;
exception when duplicate_object then null;
end $$;
