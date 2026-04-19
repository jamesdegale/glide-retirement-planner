-- Run this in the Supabase SQL Editor.

create table if not exists public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null unique,
  access_token text not null,
  institution_id text,
  institution_name text,
  created_at timestamptz not null default now()
);

create index if not exists plaid_items_user_id_idx on public.plaid_items(user_id);

create table if not exists public.plaid_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.plaid_items(id) on delete cascade,
  account_id text not null unique,
  name text,
  official_name text,
  mask text,
  type text,
  subtype text,
  category text,
  current_balance numeric,
  available_balance numeric,
  iso_currency_code text,
  updated_at timestamptz not null default now()
);

create index if not exists plaid_accounts_user_id_idx on public.plaid_accounts(user_id);
create index if not exists plaid_accounts_item_id_idx on public.plaid_accounts(item_id);

alter table public.plaid_items enable row level security;
alter table public.plaid_accounts enable row level security;

drop policy if exists "plaid_items_select_own" on public.plaid_items;
create policy "plaid_items_select_own" on public.plaid_items
  for select using (auth.uid() = user_id);

drop policy if exists "plaid_items_insert_own" on public.plaid_items;
create policy "plaid_items_insert_own" on public.plaid_items
  for insert with check (auth.uid() = user_id);

drop policy if exists "plaid_items_delete_own" on public.plaid_items;
create policy "plaid_items_delete_own" on public.plaid_items
  for delete using (auth.uid() = user_id);

drop policy if exists "plaid_accounts_select_own" on public.plaid_accounts;
create policy "plaid_accounts_select_own" on public.plaid_accounts
  for select using (auth.uid() = user_id);

drop policy if exists "plaid_accounts_insert_own" on public.plaid_accounts;
create policy "plaid_accounts_insert_own" on public.plaid_accounts
  for insert with check (auth.uid() = user_id);

drop policy if exists "plaid_accounts_update_own" on public.plaid_accounts;
create policy "plaid_accounts_update_own" on public.plaid_accounts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "plaid_accounts_delete_own" on public.plaid_accounts;
create policy "plaid_accounts_delete_own" on public.plaid_accounts
  for delete using (auth.uid() = user_id);

create table if not exists public.retirement_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  inputs jsonb not null,
  results jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists retirement_plans_user_id_idx on public.retirement_plans(user_id);

alter table public.retirement_plans enable row level security;

drop policy if exists "retirement_plans_select_own" on public.retirement_plans;
create policy "retirement_plans_select_own" on public.retirement_plans
  for select using (auth.uid() = user_id);

drop policy if exists "retirement_plans_insert_own" on public.retirement_plans;
create policy "retirement_plans_insert_own" on public.retirement_plans
  for insert with check (auth.uid() = user_id);

drop policy if exists "retirement_plans_update_own" on public.retirement_plans;
create policy "retirement_plans_update_own" on public.retirement_plans
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "retirement_plans_delete_own" on public.retirement_plans;
create policy "retirement_plans_delete_own" on public.retirement_plans
  for delete using (auth.uid() = user_id);

create table if not exists public.balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  total_assets numeric not null,
  total_liabilities numeric not null,
  net_worth numeric not null,
  snapshot_date date not null,
  created_at timestamptz not null default now()
);

create index if not exists balance_snapshots_user_id_idx on public.balance_snapshots(user_id);
create unique index if not exists balance_snapshots_user_date_idx on public.balance_snapshots(user_id, snapshot_date);

alter table public.balance_snapshots enable row level security;

drop policy if exists "balance_snapshots_select_own" on public.balance_snapshots;
create policy "balance_snapshots_select_own" on public.balance_snapshots
  for select using (auth.uid() = user_id);

drop policy if exists "balance_snapshots_insert_own" on public.balance_snapshots;
create policy "balance_snapshots_insert_own" on public.balance_snapshots
  for insert with check (auth.uid() = user_id);

drop policy if exists "balance_snapshots_update_own" on public.balance_snapshots;
create policy "balance_snapshots_update_own" on public.balance_snapshots
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "balance_snapshots_delete_own" on public.balance_snapshots;
create policy "balance_snapshots_delete_own" on public.balance_snapshots
  for delete using (auth.uid() = user_id);

create table if not exists public.manual_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  institution_name text,
  name text not null,
  type text not null,
  subtype text,
  category text not null,
  current_balance numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists manual_accounts_user_id_idx on public.manual_accounts(user_id);

alter table public.manual_accounts enable row level security;

drop policy if exists "manual_accounts_select_own" on public.manual_accounts;
create policy "manual_accounts_select_own" on public.manual_accounts
  for select using (auth.uid() = user_id);

drop policy if exists "manual_accounts_insert_own" on public.manual_accounts;
create policy "manual_accounts_insert_own" on public.manual_accounts
  for insert with check (auth.uid() = user_id);

drop policy if exists "manual_accounts_update_own" on public.manual_accounts;
create policy "manual_accounts_update_own" on public.manual_accounts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "manual_accounts_delete_own" on public.manual_accounts;
create policy "manual_accounts_delete_own" on public.manual_accounts
  for delete using (auth.uid() = user_id);
