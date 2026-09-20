// FinTrack — Lógica de ciclos de tarjetas de crédito (pura)

import { toISODate } from './formatters.js';

// Fecha del día `day` en (year, month0), ajustando a meses cortos.
function dayInMonth(year, month0, day) {
  const lastDay = new Date(year, month0 + 1, 0).getDate();
  return new Date(year, month0, Math.min(day, lastDay));
}

function addDaysISO(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/**
 * Calcula las fechas del ciclo abierto y del estado de cuenta cerrado de una
 * tarjeta a partir de su día de corte y de pago.
 * @param {{cutoffDay:number, dueDay:number}} card
 * @param {Date} refDate - fecha de referencia (hoy)
 */
export function getCardCycles(card, refDate = new Date()) {
  const cutoff = Number(card.cutoffDay);
  const due = Number(card.dueDay);
  const y = refDate.getFullYear();
  const m = refDate.getMonth();
  const ref = new Date(y, m, refDate.getDate());

  const thisCutoff = dayInMonth(y, m, cutoff);
  let lastCutoff, nextCutoff;
  if (thisCutoff <= ref) {
    lastCutoff = thisCutoff;
    nextCutoff = dayInMonth(y, m + 1, cutoff);
  } else {
    lastCutoff = dayInMonth(y, m - 1, cutoff);
    nextCutoff = thisCutoff;
  }

  const prevCutoff = dayInMonth(lastCutoff.getFullYear(), lastCutoff.getMonth() - 1, cutoff);

  // Fecha de pago: primera ocurrencia del día de pago posterior al corte.
  let dueDate = dayInMonth(lastCutoff.getFullYear(), lastCutoff.getMonth(), due);
  if (dueDate <= lastCutoff) {
    dueDate = dayInMonth(lastCutoff.getFullYear(), lastCutoff.getMonth() + 1, due);
  }

  const lastCutoffISO = toISODate(lastCutoff);
  const prevCutoffISO = toISODate(prevCutoff);

  return {
    lastCutoffISO,
    nextCutoffISO: toISODate(nextCutoff),
    openStartISO: addDaysISO(lastCutoffISO, 1),
    openEndISO: toISODate(nextCutoff),
    closedStartISO: addDaysISO(prevCutoffISO, 1),
    closedEndISO: lastCutoffISO,
    dueDateISO: toISODate(dueDate),
  };
}

/**
 * Suma (en DOP) las transacciones de una tarjeta cuya fecha cae en [startISO, endISO].
 * Monto BRUTO (lo consumido); el cashback se calcula aparte con getStatementCashback.
 */
export function getStatementAmount(transactions, cardId, startISO, endISO) {
  return transactions.reduce((sum, t) => {
    if (t.cardId !== cardId) return sum;
    if (t.date >= startISO && t.date <= endISO) return sum + (Number(t.amount) || 0);
    return sum;
  }, 0);
}

/**
 * Suma (en DOP) el cashback generado por las transacciones de una tarjeta en
 * [startISO, endISO]. Muchas tarjetas acreditan el cashback de inmediato, por lo
 * que el balance efectivo del estado de cuenta es getStatementAmount − este valor.
 */
function getStatementCashback(transactions, cardId, startISO, endISO) {
  return transactions.reduce((sum, t) => {
    if (t.cardId !== cardId) return sum;
    if (t.date >= startISO && t.date <= endISO) return sum + (Number(t.cashbackEarned) || 0);
    return sum;
  }, 0);
}

const EPOCH_ISO = '0000-01-01';
const PAID_EPSILON = 0.01;

// Inicio del período de un estado de cuenta que cierra en `endISO` (un día de
// corte): el día siguiente al corte anterior. Reutiliza dayInMonth/addDaysISO.
function statementStartForEnd(card, endISO) {
  const cutoff = Number(card?.cutoffDay);
  if (!cutoff || isNaN(cutoff)) return null; // sin día de corte válido no hay ventana
  const end = new Date(endISO + 'T00:00:00');
  const prevCutoff = dayInMonth(end.getFullYear(), end.getMonth() - 1, cutoff);
  return addDaysISO(toISODate(prevCutoff), 1);
}

/**
 * Normaliza una entrada de `paidCycles`. Soporta dos formatos:
 *  - legado: string ISO con la fecha de cierre del ciclo.
 *  - nuevo:  objeto con la foto del estado de cuenta { cycleEnd, amount, cashback, ... }.
 */
function normalizePaidEntry(entry) {
  if (typeof entry === 'string') {
    return { cycleEnd: entry, periodStart: null, periodEnd: entry, amount: 0, cashback: 0, paidAt: null };
  }
  if (entry && typeof entry === 'object') {
    return {
      cycleEnd: entry.cycleEnd,
      periodStart: entry.periodStart ?? null,
      periodEnd: entry.periodEnd ?? entry.cycleEnd,
      amount: Number(entry.amount) || 0,
      cashback: Number(entry.cashback) || 0,
      paidAt: entry.paidAt ?? null,
    };
  }
  return null;
}

/**
 * Convierte los estados de cuenta legados (`paidCycles`) en abonos equivalentes
 * { id, amount, date, note }. Permite derivar el saldo sin reescribir la base de
 * datos: estos abonos legados y los abonos nuevos (`card.payments`) son conjuntos
 * disjuntos, porque tras esta feature ya no se escribe `paidCycles`.
 * Para entradas string legado (sin monto) reconstruye el monto del estado de
 * cuenta desde las transacciones del período. Descarta las que dan monto ≤ 0.
 */
export function paidCyclesToPayments(card, transactions = []) {
  if (!card || !Array.isArray(card.paidCycles)) return [];
  return card.paidCycles
    .map((p) => {
      const n = normalizePaidEntry(p);
      if (!n || !n.cycleEnd) return null;
      let amount = Number(n.amount) || 0;
      if (amount > 0) {
        // El snapshot legado guardó el monto BRUTO con el cashback aparte; el
        // saldo se deriva en NETO, así que restamos ese cashback para no generar
        // un sobre-abono fantasma en tarjetas migradas.
        amount -= Number(n.cashback) || 0;
      } else {
        const periodEnd = n.periodEnd || n.cycleEnd;
        const periodStart = n.periodStart || statementStartForEnd(card, periodEnd);
        if (!periodStart) return null; // sin ventana válida: no reconstruir (evita inflar el saldo)
        const gross = getStatementAmount(transactions, card.id, periodStart, periodEnd);
        const cashback = getStatementCashback(transactions, card.id, periodStart, periodEnd);
        amount = gross - cashback;
      }
      return {
        id: `mig-${n.cycleEnd}`,
        amount,
        date: n.paidAt || n.cycleEnd,
        note: 'Migrado: estado de cuenta pagado',
      };
    })
    .filter((e) => e && e.amount > 0);
}

/**
 * ¿El estado de cuenta que cerró en `closedEndISO` ya fue marcado como pagado?
 * Compatible con entradas en formato string (legado) u objeto (nuevo).
 */
export function isStatementPaid(card, closedEndISO) {
  if (!card || !Array.isArray(card.paidCycles)) return false;
  return card.paidCycles.some((p) => {
    const n = normalizePaidEntry(p);
    return n && n.cycleEnd === closedEndISO;
  });
}

/**
 * Historial de estados de cuenta pagados de una tarjeta, normalizado y ordenado
 * del más reciente al más antiguo.
 */
export function getStatementHistory(card) {
  if (!card || !Array.isArray(card.paidCycles)) return [];
  return card.paidCycles
    .map(normalizePaidEntry)
    .filter(Boolean)
    .sort((a, b) => String(b.cycleEnd || '').localeCompare(String(a.cycleEnd || '')));
}

/**
 * Cashback acumulado de por vida: suma del cashback de TODAS las transacciones de
 * la tarjeta. Se calcula de las transacciones (no de paidCycles), más robusto.
 */
export function getLifetimeCashback(card, transactions = []) {
  if (!card || !card.id) return 0;
  return transactions.reduce(
    (sum, t) => (t.cardId === card.id ? sum + (Number(t.cashbackEarned) || 0) : sum),
    0
  );
}

/**
 * Saldo derivado de una tarjeta (todo neto de cashback, en DOP). Fuente única de
 * verdad para la página de Tarjetas, el Dashboard y los recordatorios del Header.
 *
 *   billed  = Σ consumo con date ≤ corte           (todo lo facturado)
 *   open    = Σ consumo en (corte, próximo corte]   (ciclo abierto, sin cortar)
 *   paid    = Σ abonos nuevos + Σ paidCycles legados (conjuntos disjuntos)
 *
 *   pendingBilled = max(0, billed − paid)   → deuda urgente (incluye arrastrado)
 *   openCycle     = max(0, open − overpay)  → consumo nuevo (overpay = prepago)
 *   totalBalance  = max(0, billed + open − paid)
 *   isPaid        = (billed − paid) ≤ EPSILON
 *
 * Un abono nunca es un gasto del presupuesto: solo liquida este saldo. El gasto
 * ya se contó al registrar cada consumo (modelo de devengo).
 */
export function getCardBalances(card, transactions = [], refDate = new Date()) {
  const cycles = getCardCycles(card, refDate);

  // Saldo inicial: deuda previa al empezar a usar la app (consumos anteriores).
  // Cuenta como ya facturado/por pagar; no es una transacción ni gasto del mes.
  const opening = Number(card?.openingBalance) || 0;

  const billed =
    opening +
    getStatementAmount(transactions, card.id, EPOCH_ISO, cycles.closedEndISO) -
    getStatementCashback(transactions, card.id, EPOCH_ISO, cycles.closedEndISO);

  const open =
    getStatementAmount(transactions, card.id, cycles.openStartISO, cycles.openEndISO) -
    getStatementCashback(transactions, card.id, cycles.openStartISO, cycles.openEndISO);

  const abonos = Array.isArray(card.payments) ? card.payments : [];
  const paidFromAbonos = abonos.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const paidFromLegacy = paidCyclesToPayments(card, transactions).reduce((s, p) => s + p.amount, 0);
  const paid = paidFromAbonos + paidFromLegacy;

  const pendingBilled = Math.max(0, billed - paid);
  const overpay = Math.max(0, paid - billed);
  const openCycle = Math.max(0, open - overpay);
  const totalBalance = Math.max(0, billed + open - paid);
  const isPaid = billed - paid <= PAID_EPSILON;

  const closedStatementNet =
    getStatementAmount(transactions, card.id, cycles.closedStartISO, cycles.closedEndISO) -
    getStatementCashback(transactions, card.id, cycles.closedStartISO, cycles.closedEndISO);
  const spansMultipleCycles = pendingBilled > closedStatementNet + PAID_EPSILON;

  return {
    cycles,
    billed, open, paid, overpay,
    pendingBilled, openCycle, totalBalance,
    closedStatementNet, spansMultipleCycles, isPaid,
  };
}

/**
 * Cashback (en DOP) que genera un monto en una tarjeta, según sus reglas.
 * Busca primero la regla de la categoría exacta y, si no hay, la regla 'all'.
 * `amount` debe estar en la moneda base (DOP); redondea a 2 decimales.
 * Fuente única de verdad — usado por el formulario (preview) y el store (guardado).
 */
export function computeCashback(card, categoryId, amount) {
  const amt = Number(amount);
  if (!card || !Array.isArray(card.cashbackRules) || !amt || isNaN(amt)) return 0;
  // Las reglas escalonadas (tiers) NO congelan cashback: las maneja
  // getDerivedCashback (en vivo, por acumulado del ciclo de corte). Aquí solo % plano.
  const flatRules = card.cashbackRules.filter((r) => typeof r.percentage === 'number');
  const rule =
    flatRules.find((r) => r.categoryId === categoryId) ||
    flatRules.find((r) => r.categoryId === 'all');
  if (!rule) return 0;
  return Math.round((amt * Number(rule.percentage)) / 100 * 100) / 100;
}

/**
 * Devuelve el % del nivel correspondiente a un monto ACUMULADO, dada una lista
 * de tiers ordenados ascendentemente por `upTo` (inclusivo). El último tier suele
 * tener upTo: Infinity. Monto ≤ 0 o sin tiers → 0.
 * @param {Array<{upTo:number, pct:number}>} tiers
 * @param {number} accumulated
 */
export function tierPercentage(tiers, accumulated) {
  const amt = Number(accumulated);
  if (!Array.isArray(tiers) || tiers.length === 0 || !amt || amt <= 0) return 0;
  for (const t of tiers) {
    if (amt <= Number(t.upTo)) return Number(t.pct) || 0;
  }
  return Number(tiers[tiers.length - 1].pct) || 0;
}

/**
 * Cashback estimado (en DOP) de UNA transacción, redondeado a 2 decimales.
 * Para reglas planas delega en computeCashback (% fijo del monto). Para reglas
 * escalonadas, ubica el ciclo de corte que CONTIENE la fecha de la transacción
 * (no el ciclo actual), calcula el nivel por el acumulado de ESE ciclo y aplica
 * ese % al monto de la transacción. Así cada transacción —de cualquier ciclo,
 * pasado o presente— muestra el cashback del nivel que alcanzó en su propio
 * ciclo, y la suma de las filas de un ciclo coincide con su cashback derivado.
 * @param {object} card
 * @param {object} tx          - la transacción a estimar
 * @param {Array}  transactions - todas las transacciones (para el acumulado del ciclo)
 */
export function getTransactionCashback(card, tx, transactions = []) {
  const amt = Number(tx?.amount);
  if (!card || !amt || isNaN(amt) || amt <= 0) return 0;

  if (!hasTieredRule(card)) {
    return computeCashback(card, tx.categoryId, amt);
  }

  // Reglas escalonadas: aplican a transacciones de la tarjeta y de la categoría
  // escalonada. El nivel se mide por el acumulado del ciclo de corte que contiene
  // la fecha de la transacción (ubicado con esa misma fecha como referencia).
  if (tx.cardId !== card.id || !tx.date) return 0;

  const rule = card.cashbackRules.find(
    (r) => Array.isArray(r.tiers) && r.tiers.length > 0 && r.categoryId === tx.categoryId
  );
  if (!rule) return 0;

  // Ciclo de corte de ESTA transacción (su fecha como referencia).
  const { openStartISO, openEndISO } = getCardCycles(card, new Date(tx.date + 'T00:00:00'));

  const accumulated = transactions.reduce((sum, t) => {
    if (t.cardId !== card.id) return sum;
    if (t.categoryId !== rule.categoryId) return sum;
    if (!t.date || t.date < openStartISO || t.date > openEndISO) return sum;
    return sum + (Number(t.amount) || 0);
  }, 0);

  const pct = tierPercentage(rule.tiers, accumulated);
  return Math.round((amt * pct) / 100 * 100) / 100;
}

/**
 * Normaliza las reglas de cashback de un formulario para guardar: conserva las
 * reglas escalonadas (con `tiers`) tal cual y las planas (con `percentage` > 0)
 * como { categoryId, percentage }. Descarta reglas sin categoryId o con % ≤ 0.
 * Evita el bug de aplanar/descartar reglas escalonadas al guardar la tarjeta.
 */
export function normalizeCashbackRules(rules) {
  return (Array.isArray(rules) ? rules : [])
    .map((r) => {
      if (!r || !r.categoryId) return null;
      if (Array.isArray(r.tiers) && r.tiers.length > 0) {
        return { categoryId: r.categoryId, tiers: r.tiers };
      }
      if (Number(r.percentage) > 0) {
        return { categoryId: r.categoryId, percentage: Number(r.percentage) };
      }
      return null;
    })
    .filter(Boolean);
}

/** ¿La tarjeta tiene al menos una regla escalonada (con `tiers`)? */
export function hasTieredRule(card) {
  return Array.isArray(card?.cashbackRules)
    && card.cashbackRules.some((r) => Array.isArray(r.tiers) && r.tiers.length > 0);
}

/**
 * Cashback DERIVADO (en vivo) para las reglas escalonadas de una tarjeta, medido
 * por CICLO DE FACTURACIÓN (entre cortes), no por mes calendario. El acumulado de
 * cada categoría escalonada se calcula sobre las transacciones del ciclo abierto
 * actual —(corte anterior, próximo corte]—, se determina el nivel por ese
 * acumulado y se aplica ese % a todo el acumulado del ciclo.
 *
 * Ej.: tarjeta que corta el 25 → el rango es del 26 de un mes al 25 del siguiente.
 *
 * Devuelve el total en DOP, redondeado a 2 decimales. Las reglas planas (sin
 * tiers) NO entran aquí: su cashback va congelado por transacción (computeCashback).
 * @param {object} card
 * @param {Array}  transactions
 * @param {Date}   refDate - fecha de referencia (hoy) para ubicar el ciclo abierto.
 */
export function getDerivedCashback(card, transactions = [], refDate = new Date()) {
  if (!hasTieredRule(card)) return 0;
  // Ventana del ciclo abierto actual: (corte anterior, próximo corte].
  const { openStartISO, openEndISO } = getCardCycles(card, refDate);
  let total = 0;
  for (const rule of card.cashbackRules) {
    if (!Array.isArray(rule.tiers) || rule.tiers.length === 0) continue;
    const accumulated = transactions.reduce((sum, t) => {
      if (t.cardId !== card.id) return sum;
      if (t.categoryId !== rule.categoryId) return sum;
      if (!t.date || t.date < openStartISO || t.date > openEndISO) return sum;
      return sum + (Number(t.amount) || 0);
    }, 0);
    const pct = tierPercentage(rule.tiers, accumulated);
    total += (accumulated * pct) / 100;
  }
  return Math.round(total * 100) / 100;
}
