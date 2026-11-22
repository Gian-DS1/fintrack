-- ============================================================================
-- FinTrack — Limpieza de `card_id` huérfano en ingresos y ahorros (one-off)
-- ============================================================================
-- Contexto: el formulario de movimientos dejaba guardado el `card_id` cuando el
-- tipo cambiaba de gasto a ingreso o ahorro. Solo un gasto puede estar ligado a
-- una tarjeta; el código ya ignora esos registros en los cálculos y desde ahora
-- no los vuelve a crear. Este script limpia los que quedaron en la base.
--
-- CÓMO USAR (a mano, en Supabase Dashboard > SQL Editor):
--   1. (Opcional) corre el PASO 1 para ver cuántas filas están afectadas.
--   2. Corre el PASO 2 (puedes correr todo el archivo de una vez).
--   3. Corre el PASO 1 otra vez: debe devolver 0 en ambas tablas.
--
-- Es IDEMPOTENTE: volver a correrlo no cambia nada una vez limpio. No toca
-- montos, fechas ni categorías; solo pone `card_id = null` donde el tipo no es
-- un gasto ('expense', 'fixed_expense', 'variable_expense').
-- ============================================================================

-- ── PASO 1 · Cuántas filas están afectadas (solo lectura) ───────────────────
select 'transactions' as tabla, count(*) as filas_con_card_id_huerfano
from public.transactions
where card_id is not null
  and type not in ('expense', 'fixed_expense', 'variable_expense')
union all
select 'recurring_transactions', count(*)
from public.recurring_transactions
where card_id is not null
  and type not in ('expense', 'fixed_expense', 'variable_expense');

-- ── PASO 2 · Limpiar ────────────────────────────────────────────────────────
update public.transactions
   set card_id = null
 where card_id is not null
   and type not in ('expense', 'fixed_expense', 'variable_expense');

update public.recurring_transactions
   set card_id = null
 where card_id is not null
   and type not in ('expense', 'fixed_expense', 'variable_expense');
