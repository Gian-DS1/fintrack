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
  last4          text,                                 -- últimos 4 dígitos (casa los correos del banco; ver add_auto_ingest.sql)
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
  source          text not null default 'manual',   -- manual | shortcut | email (registro automático)
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

-- ── Bitácora de recordatorios de préstamos ──────────────────────────────────
-- Hermana de reminder_log para las deudas (`debts`). Tabla aparte porque la PK
-- de reminder_log lleva card_id NOT NULL contra credit_cards. Los préstamos no
-- generan avisos de mora (ver src/utils/loanReminders.js).
create table if not exists public.loan_reminder_log (
  user_id     uuid not null references auth.users(id) on delete cascade,
  debt_id     uuid not null references public.debts(id) on delete cascade,
  due_date    date not null,
  offset_key  integer not null,
  channel     text not null default 'email',
  sent_at     timestamptz not null default now(),
  primary key (user_id, debt_id, due_date, offset_key, channel)
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
create index if not exists recurring_transactions_user_id_idx     on public.recurring_transactions (user_id);
create index if not exists recurring_transactions_category_id_idx on public.recurring_transactions (category_id);
create index if not exists recurring_transactions_card_id_idx     on public.recurring_transactions (card_id);
create index if not exists reminder_log_user_id_idx               on public.reminder_log (user_id);
create index if not exists loan_reminder_log_user_id_idx          on public.loan_reminder_log (user_id);

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
    'debts', 'debt_payments', 'recurring_transactions', 'reminder_log', 'loan_reminder_log'
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

-- ============================================================================
-- Registro automático de gastos (Atajos de iOS / correos del banco).
-- Copia de supabase/add_auto_ingest.sql: tokens personales con RLS propia (sin
-- UPDATE para clientes) y la función de inserción atómica que usa /api/ingest.
-- Guía y decisiones de diseño: docs/AUTO_INGEST.md.
-- ============================================================================

-- ── 1. Origen de la transacción ─────────────────────────────────────────────
alter table public.transactions
  add column if not exists source text not null default 'manual';

-- ── 2. Últimos 4 dígitos de la tarjeta ──────────────────────────────────────
-- Los correos del banco identifican la tarjeta por sus últimos 4 dígitos, no
-- por el nombre que el usuario le puso en FinTrack. Opcional (NULL = sin dato).
alter table public.credit_cards
  add column if not exists last4 text;

-- ── 3. Tokens de ingesta ────────────────────────────────────────────────────
-- El token se genera en el navegador y se muestra una sola vez; aquí vive solo
-- su hash. token_hint (últimos 4 caracteres) sirve para reconocerlo en la UI.
create table if not exists public.ingest_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null default 'iPhone',
  token_hash   text not null unique,
  token_hint   text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists ingest_tokens_user_id_idx on public.ingest_tokens (user_id);

-- RLS: el usuario lista, crea y revoca SUS tokens. No hay UPDATE para clientes:
-- un token no se edita, se revoca y se crea otro (last_used_at lo escribe el
-- endpoint con service_role, que salta RLS).
do $$
begin
  execute 'alter table public.ingest_tokens enable row level security;';
  execute 'drop policy if exists ingest_tokens_own on public.ingest_tokens;';
  execute
    'create policy ingest_tokens_own on public.ingest_tokens for all to authenticated
       using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);';
  execute 'revoke all on public.ingest_tokens from anon, authenticated;';
  execute 'grant select, insert, delete on public.ingest_tokens to authenticated;';
  execute 'grant select, insert, update, delete on public.ingest_tokens to service_role;';
end $$;

-- ── 4. Inserción atómica con deduplicación ──────────────────────────────────
-- Un mismo consumo puede llegar por DOS canales casi a la vez: el toque de
-- Apple Pay dispara el atajo y, segundos después, llega el correo del banco.
-- Comprobar-e-insertar desde el endpoint tendría una carrera, así que se hace
-- aquí bajo un advisory lock por usuario (se libera al terminar la transacción).
--
-- Se considera duplicado, dentro del mismo día y con el mismo monto:
--   - otro canal automático en las últimas 48 h (toque + correo del mismo pago),
--     siempre que las tarjetas no se contradigan;
--   - el mismo canal en los últimos 2 minutos (reintento del atajo).
-- Dos compras legítimas iguales el mismo día por el mismo canal (dos pasajes)
-- sí se registran: por eso la ventana del mismo canal es corta.
--
-- Límite: 60 registros automáticos por usuario por hora. Un token filtrado no
-- puede inundar la cuenta, y un atajo en bucle se corta solo.
--
-- Devuelve { status: 'created' | 'duplicate' | 'rate_limited', id }.
create or replace function public.ingest_transaction(
  p_user_id     uuid,
  p_amount      numeric,
  p_date        date,
  p_type        text,
  p_description text,
  p_category_id uuid,
  p_card_id     uuid,
  p_currency    text,
  p_cashback    numeric,
  p_notes       text,
  p_source      text
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_recent integer;
  v_id     uuid;
begin
  if p_source not in ('shortcut', 'email') then
    raise exception 'ingest_transaction: source inválido (%)', p_source;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'ingest_transaction: monto inválido';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select count(*) into v_recent
  from public.transactions
  where user_id = p_user_id
    and source <> 'manual'
    and created_at > now() - interval '1 hour';
  if v_recent >= 60 then
    return jsonb_build_object('status', 'rate_limited', 'id', null);
  end if;

  select id into v_id
  from public.transactions
  where user_id = p_user_id
    and date = p_date
    and amount = p_amount
    and source <> 'manual'
    and (
      (source <> p_source
        and created_at > now() - interval '48 hours'
        and (card_id is null or p_card_id is null or card_id = p_card_id))
      or
      (source = p_source and created_at > now() - interval '2 minutes')
    )
  order by created_at desc
  limit 1;
  if v_id is not null then
    return jsonb_build_object('status', 'duplicate', 'id', v_id);
  end if;

  insert into public.transactions
    (user_id, category_id, card_id, amount, type, description, date, notes, currency, cashback_earned, source)
  values
    (p_user_id, p_category_id, p_card_id, p_amount, p_type, p_description, p_date, p_notes,
     coalesce(p_currency, 'DOP'), coalesce(p_cashback, 0), p_source)
  returning id into v_id;

  return jsonb_build_object('status', 'created', 'id', v_id);
end;
$$;

-- Solo el endpoint (service_role) puede ejecutarla. Además es SECURITY INVOKER:
-- aunque un cliente lograra invocarla, RLS le impediría escribir filas ajenas.
revoke all on function public.ingest_transaction(uuid, numeric, date, text, text, uuid, uuid, text, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.ingest_transaction(uuid, numeric, date, text, text, uuid, uuid, text, numeric, text, text)
  to service_role;
