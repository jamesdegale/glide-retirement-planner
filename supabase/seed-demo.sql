-- ============================================================
-- GLIDE DEMO SEED
-- Run in Supabase SQL Editor after schema.sql
-- User: bb87935a-690e-4a73-8e19-9e89b65202b7
-- ============================================================

-- 1. balance_snapshots table (idempotent)
-- --------------------------------------------------------
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


-- 1b. manual_accounts table (idempotent)
-- --------------------------------------------------------
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


-- 2. Demo plaid_items + plaid_accounts
-- --------------------------------------------------------
-- Clean up any previous demo data for this user
delete from public.plaid_accounts where user_id = 'bb87935a-690e-4a73-8e19-9e89b65202b7';
delete from public.plaid_items    where user_id = 'bb87935a-690e-4a73-8e19-9e89b65202b7';
delete from public.balance_snapshots where user_id = 'bb87935a-690e-4a73-8e19-9e89b65202b7';

-- Plaid items (one per institution connection)
insert into public.plaid_items (id, user_id, item_id, access_token, institution_id, institution_name) values
  ('a1a1a1a1-0001-4000-8000-000000000001', 'bb87935a-690e-4a73-8e19-9e89b65202b7', 'demo_item_fidelity',   'demo_access_fidelity',   'ins_12',  'Fidelity'),
  ('a1a1a1a1-0002-4000-8000-000000000002', 'bb87935a-690e-4a73-8e19-9e89b65202b7', 'demo_item_vanguard',   'demo_access_vanguard',   'ins_17',  'Vanguard'),
  ('a1a1a1a1-0003-4000-8000-000000000003', 'bb87935a-690e-4a73-8e19-9e89b65202b7', 'demo_item_schwab',     'demo_access_schwab',     'ins_16',  'Charles Schwab'),
  ('a1a1a1a1-0004-4000-8000-000000000004', 'bb87935a-690e-4a73-8e19-9e89b65202b7', 'demo_item_chase',      'demo_access_chase',      'ins_3',   'Chase'),
  ('a1a1a1a1-0005-4000-8000-000000000005', 'bb87935a-690e-4a73-8e19-9e89b65202b7', 'demo_item_ally',       'demo_access_ally',       'ins_27',  'Ally Bank'),
  ('a1a1a1a1-0006-4000-8000-000000000006', 'bb87935a-690e-4a73-8e19-9e89b65202b7', 'demo_item_manual',     'demo_access_manual',     null,      'Manual Entry'),
  ('a1a1a1a1-0007-4000-8000-000000000007', 'bb87935a-690e-4a73-8e19-9e89b65202b7', 'demo_item_toyota',     'demo_access_toyota',     null,      'Toyota Financial Services');

-- Plaid accounts
insert into public.plaid_accounts
  (user_id, item_id, account_id, name, official_name, mask, type, subtype, category, current_balance, available_balance, iso_currency_code)
values
  -- Fidelity 401(k)
  ('bb87935a-690e-4a73-8e19-9e89b65202b7',
   'a1a1a1a1-0001-4000-8000-000000000001',
   'demo_acct_fidelity_401k', 'Fidelity 401(k)', 'FIDELITY INVESTMENTS 401(K)', '4821',
   'investment', '401k', 'retirement',
   284500, null, 'USD'),

  -- Vanguard Rollover IRA
  ('bb87935a-690e-4a73-8e19-9e89b65202b7',
   'a1a1a1a1-0002-4000-8000-000000000002',
   'demo_acct_vanguard_ira', 'Vanguard Rollover IRA', 'VANGUARD TRADITIONAL IRA', '2204',
   'investment', 'ira', 'retirement',
   156200, null, 'USD'),

  -- Charles Schwab Brokerage
  ('bb87935a-690e-4a73-8e19-9e89b65202b7',
   'a1a1a1a1-0003-4000-8000-000000000003',
   'demo_acct_schwab_brokerage', 'Schwab Individual Brokerage', 'CHARLES SCHWAB BROKERAGE ACCOUNT', '9341',
   'investment', 'brokerage', 'investment',
   42800, null, 'USD'),

  -- Chase Checking
  ('bb87935a-690e-4a73-8e19-9e89b65202b7',
   'a1a1a1a1-0004-4000-8000-000000000004',
   'demo_acct_chase_checking', 'Chase Total Checking', 'CHASE TOTAL CHECKING', '1847',
   'depository', 'checking', 'banking',
   12400, 11850, 'USD'),

  -- Ally Savings
  ('bb87935a-690e-4a73-8e19-9e89b65202b7',
   'a1a1a1a1-0005-4000-8000-000000000005',
   'demo_acct_ally_savings', 'Ally Online Savings', 'ALLY BANK ONLINE SAVINGS ACCOUNT', '3392',
   'depository', 'savings', 'banking',
   28000, 28000, 'USD'),

  -- Primary Residence (manual real estate entry)
  ('bb87935a-690e-4a73-8e19-9e89b65202b7',
   'a1a1a1a1-0006-4000-8000-000000000006',
   'demo_acct_primary_residence', 'Primary Residence', 'PRIMARY RESIDENCE — ESTIMATED VALUE', null,
   'other', 'real_estate', 'other',
   485000, null, 'USD'),

  -- Toyota Auto Loan
  ('bb87935a-690e-4a73-8e19-9e89b65202b7',
   'a1a1a1a1-0007-4000-8000-000000000007',
   'demo_acct_toyota_loan', 'Toyota Camry Loan', 'TOYOTA MOTOR CREDIT AUTO LOAN', '7823',
   'loan', 'auto', 'loans',
   18400, null, 'USD'),

  -- Chase Credit Card
  ('bb87935a-690e-4a73-8e19-9e89b65202b7',
   'a1a1a1a1-0004-4000-8000-000000000004',
   'demo_acct_chase_cc', 'Chase Sapphire Preferred', 'CHASE SAPPHIRE PREFERRED CARD', '5521',
   'credit', 'credit card', 'loans',
   4200, 25800, 'USD');


-- 3. Balance snapshots — 12 months of history
-- --------------------------------------------------------
-- Net worth grows ~965,000 → 986,300 with natural variation
-- Liabilities decline ~25,600 → 22,600 (auto loan paydown)

insert into public.balance_snapshots (user_id, total_assets, total_liabilities, net_worth, snapshot_date) values
  ('bb87935a-690e-4a73-8e19-9e89b65202b7',  990600, 25600, 965000, '2025-05-19'),
  ('bb87935a-690e-4a73-8e19-9e89b65202b7',  996550, 25350, 971200, '2025-06-19'),
  ('bb87935a-690e-4a73-8e19-9e89b65202b7', 1001900, 25100, 976800, '2025-07-19'),
  ('bb87935a-690e-4a73-8e19-9e89b65202b7',  983250, 24850, 958400, '2025-08-19'),
  ('bb87935a-690e-4a73-8e19-9e89b65202b7',  976700, 24600, 952100, '2025-09-19'),
  ('bb87935a-690e-4a73-8e19-9e89b65202b7',  993650, 24350, 969300, '2025-10-19'),
  ('bb87935a-690e-4a73-8e19-9e89b65202b7', 1001600, 24100, 977500, '2025-11-19'),
  ('bb87935a-690e-4a73-8e19-9e89b65202b7', 1005050, 23850, 981200, '2025-12-19'),
  ('bb87935a-690e-4a73-8e19-9e89b65202b7',  998200, 23600, 974600, '2026-01-19'),
  ('bb87935a-690e-4a73-8e19-9e89b65202b7', 1003150, 23350, 979800, '2026-02-19'),
  ('bb87935a-690e-4a73-8e19-9e89b65202b7', 1006600, 23100, 983500, '2026-03-19'),
  ('bb87935a-690e-4a73-8e19-9e89b65202b7', 1008900, 22600, 986300, '2026-04-19');
