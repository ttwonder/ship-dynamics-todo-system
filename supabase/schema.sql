create table if not exists public.ship_dynamics_app_state (
  workspace_key text primary key,
  payload jsonb not null,
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.ship_dynamics_app_state enable row level security;

drop policy if exists "ship dynamics public read workspace" on public.ship_dynamics_app_state;
create policy "ship dynamics public read workspace"
  on public.ship_dynamics_app_state for select
  using (true);

drop policy if exists "ship dynamics public upsert workspace" on public.ship_dynamics_app_state;
create policy "ship dynamics public upsert workspace"
  on public.ship_dynamics_app_state for insert
  with check (true);

drop policy if exists "ship dynamics public update workspace" on public.ship_dynamics_app_state;
create policy "ship dynamics public update workspace"
  on public.ship_dynamics_app_state for update
  using (true)
  with check (true);

-- 說明：
-- 這是 GitHub Pages 靜態前端的輕量共享 payload 模式。
-- 產品級強權限仍在前端 Owner/Admin/Operator 與操作紀錄中執行；
-- 若日後要改成 Supabase Auth + 嚴格 RLS，可將 payload 拆分為 users/vessels/tasks/audit_logs 多表。
