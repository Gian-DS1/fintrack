-- ============================================================================
-- FinTrack — Recordatorios de pago de tarjetas por correo (2026-09-19)
-- ============================================================================
-- Ejecuta este archivo COMPLETO en el SQL Editor de Supabase. Es idempotente y
-- aditivo: no toca datos existentes y puedes correrlo varias veces.
--
--   1. profiles.reminders_enabled / reminder_days_before → preferencias.
--   2. reminder_log → evita enviar dos veces el mismo aviso del mismo ciclo.
--
-- Lo consume el cron diario /api/cron/card-reminders con la service_role key.
-- ============================================================================

-- ── 1. Preferencias de recordatorio en el perfil ────────────────────────────
-- Default true: el usuario pidió esta función explícitamente, así que no tiene
-- sentido obligarlo a activarla después. Para un despliegue multi-tenant,
-- cambiar a `default false` (opt-in) ANTES de correr este archivo.
alter table public.profiles
  add column if not exists reminders_enabled boolean not null default true;

-- Días de antelación del aviso. {5,1} = un correo 5 días antes y otro la
-- víspera. El aviso del mismo día (0) y los de mora son automáticos y NO se
-- configuran aquí: van siempre mientras la tarjeta siga sin pagarse.
alter table public.profiles
  add column if not exists reminder_days_before integer[] not null default '{5,1}';

-- ── 2. Bitácora de envíos (deduplicación) ───────────────────────────────────
-- Una fila por (usuario, tarjeta, fecha de pago, antelación, canal). La PK
-- compuesta ES la garantía de "una sola vez": el cron inserta DESPUÉS de un
-- envío exitoso, así que un fallo de correo simplemente se reintenta mañana.
--
-- offset_key: días respecto a la fecha de pago.
--   5, 1 → avisos de antelación configurables
--   0    → vence hoy
--  -1..-3 → mora (el cron deja de insistir pasados 3 días)
create table if not exists public.reminder_log (
  user_id     uuid not null references auth.users(id) on delete cascade,
  card_id     uuid not null references public.credit_cards(id) on delete cascade,
  due_date    date not null,
  offset_key  integer not null,
  channel     text not null default 'email',
  sent_at     timestamptz not null default now(),
  primary key (user_id, card_id, due_date, offset_key, channel)
);

create index if not exists reminder_log_user_id_idx on public.reminder_log (user_id);

-- RLS: mismo patrón que el resto de tablas (ver schema.sql). El usuario puede
-- leer su propia bitácora; el cron escribe con service_role, que salta RLS.
do $$
begin
  execute 'alter table public.reminder_log enable row level security;';
  execute 'drop policy if exists reminder_log_own on public.reminder_log;';
  execute
    'create policy reminder_log_own on public.reminder_log for all to authenticated
       using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);';
  execute 'revoke all on public.reminder_log from anon;';
  execute 'grant select, insert, update, delete on public.reminder_log to authenticated, service_role;';
end $$;
