-- Retirement Scenarios — multiple plans per user
-- Run in Supabase SQL Editor

create table if not exists public.retirement_scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Base plan',
  is_base boolean not null default false,
  inputs jsonb not null,
  results jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists retirement_scenarios_user_id_idx on public.retirement_scenarios(user_id);

alter table public.retirement_scenarios enable row level security;

drop policy if exists "retirement_scenarios_select_own" on public.retirement_scenarios;
create policy "retirement_scenarios_select_own" on public.retirement_scenarios
  for select using (auth.uid() = user_id);

drop policy if exists "retirement_scenarios_insert_own" on public.retirement_scenarios;
create policy "retirement_scenarios_insert_own" on public.retirement_scenarios
  for insert with check (auth.uid() = user_id);

drop policy if exists "retirement_scenarios_update_own" on public.retirement_scenarios;
create policy "retirement_scenarios_update_own" on public.retirement_scenarios
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "retirement_scenarios_delete_own" on public.retirement_scenarios;
create policy "retirement_scenarios_delete_own" on public.retirement_scenarios
  for delete using (auth.uid() = user_id);

-- Migrate existing retirement_plans data into scenarios (run once, safe to re-run)
insert into public.retirement_scenarios (user_id, name, is_base, inputs, results, created_at, updated_at)
select user_id, 'Base plan', true, inputs, results, created_at, updated_at
from public.retirement_plans
where not exists (
  select 1 from public.retirement_scenarios s where s.user_id = retirement_plans.user_id and s.is_base = true
);
