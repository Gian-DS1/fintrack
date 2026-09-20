-- ============================================================================
-- FinTrack RD — Esquema completo de base de datos (Supabase / PostgreSQL)
-- ============================================================================
-- Ejecuta este archivo COMPLETO en el SQL Editor de tu proyecto Supabase para
-- dejar la base de datos lista. Es idempotente: puedes correrlo varias veces.
--
-- Modelo de seguridad:
--   - Cada tabla tiene una columna `user_id` que referencia auth.users.
--   - Row Level Security (RLS) está ACTIVADO en todas las tablas y la política
--     permite a cada usuario ver/editar SOLO sus propias filas (auth.uid()).
--   - Sin RLS, la llave anónima (pública) permitiría leer datos de todos los
--     usuarios. Por eso RLS es OBLIGATORIO y este script lo configura.
--
-- Nota: las tablas creadas por SQL crudo NO otorgan privilegios automáticamente
-- a los roles de Supabase, por eso al final se hacen los GRANT explícitos.
-- ============================================================================

-- ── Perfiles (Preferencias) ─────────────────────────────────────────────────
create table if not exists public.profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  budget_level  text not null default 'tracking',
  tutorial_seen boolean not null default false,
  -- Recordatorios de pago de tarjetas por correo (ver add_card_reminders.sql).
  -- reminder_days_before: días de antelación del aviso. El aviso del día del
  -- vencimiento y los de mora son automáticos y no se configuran aquí.
  reminders_enabled    boolean not null default true,
  reminder_days_before integer[] not null default '{5,1}',
  updated_at    timestamptz not null default now()
);

-- ── Categorías ──────────────────────────────────────────────────────────────
create table if not exists public.categories (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  name               text not null,
  type               text not null,                 -- income | fixed_expense | variable_expense | savings
  icon               text,
  color              text,
  slug               text,
  keywords           text[] not null default '{}',
  is_active          boolean not null default true,
  sort_order         integer not null default 0,
  is_accumulative    boolean not null default false,
  accumulation_start text,                           -- 'YYYY-MM' (bote/sinking fund)
  created_at         timestamptz not null default now()
);

-- ── Tarjetas de crédito ─────────────────────────────────────────────────────
create table if not exists public.credit_cards (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  name           text not null,
  bank           text,
  cutoff_day     integer not null,                  -- día de corte (1-31)
  due_day        integer not null,                  -- día de pago (1-31)
  opening_balance numeric not null default 0,
  color          text default '#6366f1',
  paid_cycles    jsonb not null default '[]'::jsonb,  -- historial de estados de cuenta pagados (legado)
  payments       jsonb not null default '[]'::jsonb,  -- abonos / pagos parciales [{ id, amount, date, note }]
  cashback_rules jsonb not null default '[]'::jsonb,  -- [{ categoryId, percentage }]
  catalog_id     text,                                 -- id del template del catálogo (NULL = personalizada)
  created_at     timestamptz not null default now()
);

-- ── Transacciones ───────────────────────────────────────────────────────────
create table if not exists public.transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  category_id     uuid references public.categories(id) on delete set null,
  card_id         uuid references public.credit_cards(id) on delete set null,
  amount          numeric not null,                 -- siempre en DOP (moneda base)
  type            text not null,                    -- income | expense | fixed_expense | variable_expense | savings
  description     text,
  date            date not null,
  notes           text,
  currency        text not null default 'DOP',
  cashback_earned numeric not null default 0,
  created_at      timestamptz not null default now(),
  constraint transactions_type_check check (type in ('income','expense','fixed_expense','variable_expense','savings')),
  constraint transactions_amount_positive check (amount >= 0)
);
create index if not exists transactions_user_date_idx on public.transactions (user_id, date desc);

-- ── Presupuestos (base cero, por mes y categoría) ───────────────────────────
create table if not exists public.budgets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete cascade,
  amount      numeric not null default 0,
  month       text not null,                         -- 'YYYY-MM'
  created_at  timestamptz not null default now(),
  unique (user_id, category_id, month)
);

-- ── Grupos de presupuesto (varias categorías vistas como un total) ──────────
create table if not exists public.budget_groups (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  icon         text,
  category_ids uuid[] not null default '{}',
  created_at   timestamptz not null default now()
);

-- ── Metas de ahorro ─────────────────────────────────────────────────────────
create table if not exists public.savings (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  title          text not null,
  target_amount  numeric not null default 0,
  current_amount numeric not null default 0,
  deadline       date,
  icon           text,
  color          text,
  status         text not null default 'active',     -- active | paused | completed
  currency       text not null default 'DOP',
  monthly_contribution numeric not null default 0,
  horizon        text,                                -- short | medium | long (etiqueta, opcional)
  created_at     timestamptz not null default now()
);

-- ── Deudas ──────────────────────────────────────────────────────────────────
create table if not exists public.debts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  creditor_name   text not null,
  total_amount    numeric not null default 0,
  current_balance numeric not null default 0,
  interest_rate   numeric not null default 0,
  minimum_payment numeric not null default 0,        -- "pago mensual" en la UI
  due_date        date,                              -- fecha de pago (alimenta los recordatorios)
  status          text not null default 'active',    -- active | paid_off
  currency        text not null default 'DOP',
  created_at      timestamptz not null default now(),
  constraint debts_balance_non_negative check (current_balance >= 0)
);

-- ── Pagos de deudas ─────────────────────────────────────────────────────────
create table if not exists public.debt_payments (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  debt_id           uuid not null references public.debts(id) on delete cascade,
  amount            numeric not null,
  date              date not null,
  remaining_balance numeric,
  notes             text,
  -- Enlace a la transacción autogenerada por el pago, para poder revertirla
  -- exactamente al eliminar el pago. set null: si la transacción se borra por
  -- otro lado, el pago no se cae, solo pierde el enlace.
  transaction_id    uuid references public.transactions(id) on delete set null,
  created_at        timestamptz not null default now()
);

-- Migración para proyectos creados antes de esta columna (idempotente).
alter table public.debt_payments
  add column if not exists transaction_id uuid references public.transactions(id) on delete set null;

-- ── Aportes de ahorro (espejo de debt_payments) ─────────────────────────────
create table if not exists public.savings_contributions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  goal_id         uuid not null references public.savings(id) on delete cascade,
  amount          numeric not null,
  date            date not null,
  notes           text,
  transaction_id  uuid references public.transactions(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- ── Plan financiero (metas a corto/mediano/largo plazo) ─────────────────────
create table if not exists public.plans (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  title          text not null,
  description    text,
  target_amount  numeric not null default 0,
  current_amount numeric not null default 0,
  deadline       date,
  type           text,                               -- short | medium | long (horizonte)
  status         text not null default 'pending',    -- pending | in_progress | completed
  created_at     timestamptz not null default now()
);

-- ── Transacciones recurrentes (plantillas) ──────────────────────────────────
create table if not exists public.recurring_transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  card_id     uuid references public.credit_cards(id) on delete set null,
  amount      numeric not null,
  type        text not null,
  description text,
  notes       text,
  currency    text not null default 'DOP',
  frequency   text not null default 'monthly',       -- weekly | biweekly | monthly
  next_date   date not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ── Bitácora de recordatorios enviados ──────────────────────────────────────
-- Deduplicación de los correos de pago de tarjetas. La PK compuesta garantiza
-- que un mismo aviso (tarjeta + fecha de pago + antelación) se envía una sola
-- vez. offset_key: 5/1 = antelación, 0 = vence hoy, -1..-3 = mora.
create table if not exists public.reminder_log (
  user_id     uuid not null references auth.users(id) on delete cascade,
  card_id     uuid not null references public.credit_cards(id) on delete cascade,
  due_date    date not null,
  offset_key  integer not null,
  channel     text not null default 'email',
  sent_at     timestamptz not null default now(),
  primary key (user_id, card_id, due_date, offset_key, channel)
);

-- ============================================================================
-- Índices sobre foreign keys (acelera JOINs y DELETE en cascada).
-- transactions.user_id ya queda cubierto por transactions_user_date_idx.
-- ============================================================================
create index if not exists categories_user_id_idx                 on public.categories (user_id);
create index if not exists credit_cards_user_id_idx               on public.credit_cards (user_id);
create index if not exists transactions_category_id_idx           on public.transactions (category_id);
create index if not exists transactions_card_id_idx               on public.transactions (card_id);
create index if not exists budgets_user_id_idx                    on public.budgets (user_id);
create index if not exists budgets_category_id_idx                on public.budgets (category_id);
create index if not exists budget_groups_user_id_idx              on public.budget_groups (user_id);
create index if not exists savings_user_id_idx                    on public.savings (user_id);
create index if not exists debts_user_id_idx                      on public.debts (user_id);
create index if not exists debt_payments_user_id_idx              on public.debt_payments (user_id);
create index if not exists debt_payments_debt_id_idx              on public.debt_payments (debt_id);
create index if not exists debt_payments_transaction_id_idx       on public.debt_payments (transaction_id);
create index if not exists savings_contributions_user_id_idx      on public.savings_contributions (user_id);
create index if not exists savings_contributions_goal_id_idx      on public.savings_contributions (goal_id);
create index if not exists savings_contributions_transaction_id_idx on public.savings_contributions (transaction_id);
create index if not exists plans_user_id_idx                      on public.plans (user_id);
create index if not exists recurring_transactions_user_id_idx     on public.recurring_transactions (user_id);
create index if not exists recurring_transactions_category_id_idx on public.recurring_transactions (category_id);
create index if not exists recurring_transactions_card_id_idx     on public.recurring_transactions (card_id);
create index if not exists reminder_log_user_id_idx               on public.reminder_log (user_id);

-- ============================================================================
-- Row Level Security + políticas "solo mis filas" + grants para cada tabla.
-- auth.uid() se envuelve en (select ...) para que Postgres lo evalúe una vez
-- por consulta y no por fila (recomendación de performance de Supabase).
-- No se otorgan privilegios a `anon`: el cliente anónimo no toca estas tablas.
-- ============================================================================
do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'categories', 'credit_cards', 'transactions', 'budgets', 'budget_groups',
    'savings', 'savings_contributions',
    'debts', 'debt_payments', 'plans', 'recurring_transactions', 'reminder_log'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t || '_own', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);',
      t || '_own', t
    );
    execute format('revoke all on public.%I from anon;', t);
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated, service_role;',
      t
    );
  end loop;
end $$;
