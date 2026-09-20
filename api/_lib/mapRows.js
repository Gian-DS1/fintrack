// FinTrack — Mapeo snake_case (Supabase) → camelCase (lógica de negocio).
//
// Espejo de los mapeadores de los stores del front: useCreditCardStore.mapFromDb
// y el de useTransactionStore. El cron no puede importar los stores (arrastran
// Zustand, el cliente de Supabase del navegador y demoMode), así que replica
// solo el mapeo. Si cambia el shape en un store, hay que cambiarlo aquí.

/** Fila de credit_cards → tarjeta en camelCase (shape que espera getCardBalances). */
export function mapCardRow(row) {
  return {
    id: row.id,
    name: row.name,
    bank: row.bank || '',
    cutoffDay: Number(row.cutoff_day),
    dueDay: Number(row.due_day),
    color: row.color || '#6366f1',
    openingBalance: Number(row.opening_balance) || 0,
    paidCycles: Array.isArray(row.paid_cycles) ? row.paid_cycles : [],
    payments: Array.isArray(row.payments) ? row.payments : [],
    cashbackRules: Array.isArray(row.cashback_rules) ? row.cashback_rules : [],
    catalogId: row.catalog_id || null,
  };
}

/** Fila de transactions → transacción en camelCase. */
export function mapTransactionRow(row) {
  return {
    id: row.id,
    cardId: row.card_id || null,
    date: row.date,
    amount: Number(row.amount) || 0,
    cashbackEarned: row.cashback_earned ? Number(row.cashback_earned) : 0,
  };
}

/** Agrupa filas por user_id → Map<userId, Array>. */
export function groupByUser(rows = [], map = (r) => r) {
  const out = new Map();
  for (const row of rows) {
    const list = out.get(row.user_id);
    if (list) list.push(map(row));
    else out.set(row.user_id, [map(row)]);
  }
  return out;
}
