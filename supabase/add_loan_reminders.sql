-- ============================================================================
-- FinTrack — Recordatorios de pago de PRÉSTAMOS por correo (2026-09-20)
-- ============================================================================
-- Ejecuta este archivo COMPLETO en el SQL Editor de Supabase. Es idempotente y
-- aditivo: no toca datos existentes y puedes correrlo varias veces.
--
-- Extiende los recordatorios de tarjetas (add_card_reminders.sql) para que el
-- mismo correo diario incluya también los préstamos (tabla `debts`).
--
-- NO añade preferencias nuevas: el toggle `profiles.reminders_enabled` y las
-- antelaciones `profiles.reminder_days_before` son COMPARTIDOS entre tarjetas y
-- préstamos, por decisión de producto (un solo correo, un solo interruptor).
--
-- Requisito previo: add_card_reminders.sql (o schema.sql) ya ejecutado.
-- Lo consume el cron diario /api/cron/card-reminders con la service_role key.
-- ============================================================================

-- ── Bitácora de envíos de préstamos (deduplicación) ─────────────────────────
-- Tabla HERMANA de reminder_log, no una columna más en ella: la PK de
-- reminder_log es (user_id, card_id, ...) con card_id NOT NULL referenciando
-- credit_cards. Meter préstamos ahí obligaría a reescribir esa PK y a hacer
-- card_id nullable sobre una tabla con datos. Una tabla aparte es aditiva y no
-- pone en riesgo ni una fila existente.
--
-- offset_key: días respecto a la fecha de pago.
--   5, 1 → avisos de antelación configurables (compartidos con las tarjetas)
--   0    → vence hoy
-- Los préstamos NO generan avisos de mora (ver src/utils/loanReminders.js).
create table if not exists public.loan_reminder_log (
  user_id     uuid not null references auth.users(id) on delete cascade,
  debt_id     uuid not null references public.debts(id) on delete cascade,
  due_date    date not null,
  offset_key  integer not null,
  channel     text not null default 'email',
  sent_at     timestamptz not null default now(),
  primary key (user_id, debt_id, due_date, offset_key, channel)
);

create index if not exists loan_reminder_log_user_id_idx on public.loan_reminder_log (user_id);

-- RLS: mismo patrón que el resto de tablas (ver schema.sql). El usuario puede
-- leer su propia bitácora; el cron escribe con service_role, que salta RLS.
do $$
begin
  execute 'alter table public.loan_reminder_log enable row level security;';
  execute 'drop policy if exists loan_reminder_log_own on public.loan_reminder_log;';
  execute
    'create policy loan_reminder_log_own on public.loan_reminder_log for all to authenticated
       using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);';
  execute 'revoke all on public.loan_reminder_log from anon;';
  execute 'grant select, insert, update, delete on public.loan_reminder_log to authenticated, service_role;';
end $$;
