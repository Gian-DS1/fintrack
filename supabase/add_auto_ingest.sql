-- ============================================================================
-- FinTrack — Registro automático de gastos (2026-11-17)
-- ============================================================================
-- Ejecuta este archivo COMPLETO en el SQL Editor de Supabase. Es idempotente y
-- aditivo: no toca datos existentes y puedes correrlo varias veces.
--
--   1. transactions.source      → de dónde vino la fila (manual|shortcut|email).
--      transactions.external_id → id del mensaje de origen (idempotencia).
--   2. credit_cards.last4       → para casar el correo del banco con la tarjeta.
--   3. ingest_tokens            → tokens personales (solo se guarda el SHA-256).
--   4. ingest_transaction(...)  → inserción atómica con deduplicación y límite.
--
-- Lo consume el endpoint /api/ingest con la service_role key. Guía de uso y
-- decisiones de diseño: docs/AUTO_INGEST.md.
-- ============================================================================

-- ── 1. Origen de la transacción ─────────────────────────────────────────────
alter table public.transactions
  add column if not exists source text not null default 'manual';

-- Identificador del mensaje en el sistema de origen (p. ej. el id del correo en
-- Gmail). Hace idempotente el reproceso: el mismo correo enviado dos veces no
-- crea dos gastos, y dos compras idénticas en correos distintos sí crean dos.
alter table public.transactions
  add column if not exists external_id text;
create unique index if not exists transactions_external_id_key
  on public.transactions (user_id, source, external_id)
  where external_id is not null;

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
-- Se considera duplicado, con el mismo monto:
--   - otro canal automático en las últimas 48 h (toque + correo del mismo pago),
--     con fecha igual o contigua (un correo procesado pasada la medianoche, o
--     que no trae fecha, cae en el día siguiente) y tarjetas que no se contradigan;
--   - el mismo canal con el mismo external_id (el mismo correo, reprocesado);
--   - el mismo canal SIN external_id, misma fecha, en los últimos 2 minutos
--     (reintento del atajo, que no tiene un id de mensaje que mandar).
-- Dos compras legítimas iguales el mismo día por el mismo canal (dos pasajes)
-- sí se registran: por eso la ventana del mismo canal es corta.
--
-- Límite: 60 registros automáticos por usuario por hora. Un token filtrado no
-- puede inundar la cuenta, y un atajo en bucle se corta solo.
--
-- Devuelve { status: 'created' | 'duplicate' | 'rate_limited', id }.
-- Firma anterior (sin p_external_id): se elimina para no dejar dos sobrecargas.
drop function if exists public.ingest_transaction(uuid, numeric, date, text, text, uuid, uuid, text, numeric, text, text);

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
  p_source      text,
  p_external_id text default null
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
    and source <> 'manual'
    and (
      (source <> p_source
        and amount = p_amount
        and date between p_date - 1 and p_date + 1
        and created_at > now() - interval '48 hours'
        and (card_id is null or p_card_id is null or card_id = p_card_id))
      or
      (source = p_source and p_external_id is not null and external_id = p_external_id)
      or
      (source = p_source and p_external_id is null and external_id is null
        and amount = p_amount and date = p_date and created_at > now() - interval '2 minutes')
    )
  order by created_at desc
  limit 1;
  if v_id is not null then
    return jsonb_build_object('status', 'duplicate', 'id', v_id);
  end if;

  insert into public.transactions
    (user_id, category_id, card_id, amount, type, description, date, notes, currency, cashback_earned, source, external_id)
  values
    (p_user_id, p_category_id, p_card_id, p_amount, p_type, p_description, p_date, p_notes,
     coalesce(p_currency, 'DOP'), coalesce(p_cashback, 0), p_source, p_external_id)
  returning id into v_id;

  return jsonb_build_object('status', 'created', 'id', v_id);
end;
$$;

-- Solo el endpoint (service_role) puede ejecutarla. Además es SECURITY INVOKER:
-- aunque un cliente lograra invocarla, RLS le impediría escribir filas ajenas.
revoke all on function public.ingest_transaction(uuid, numeric, date, text, text, uuid, uuid, text, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function public.ingest_transaction(uuid, numeric, date, text, text, uuid, uuid, text, numeric, text, text, text)
  to service_role;
