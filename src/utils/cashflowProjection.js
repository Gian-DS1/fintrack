// FinTrack — Movimientos previstos del efectivo hasta el próximo pago de tarjeta
// (lógica pura, entrega 2 de «Dinero real y proyección»).
//
// Responde «¿me alcanza hasta el pago?»: parte del efectivo líquido de hoy y le
// aplica, en orden de fecha, los ingresos y gastos recurrentes y el pago completo
// de cada tarjeta. No lee stores ni la hora: todo llega por parámetro (`refDate`).
// Es una lista de EFECTIVO (lo que hay en el banco cada día), no de dinero real.

import { advanceDate, nextMonthlyOccurrence } from './recurrence.js';
import { getNextLoanDueDate } from './loanReminders.js';
import { getCardBalances, getCardCycles, hasValidCardCycle } from './creditCards.js';
import { toISODate } from './formatters.js';
import { getLiquidCash, computeShortfall } from '../stitch/screens/dashboard/selectors.js';

// Guarda contra plantillas con fechas absurdas: una semanal a 45 días son 7 pasos.
const MAX_STEPS = 400;
const NO_CARD_HORIZON_DAYS = 30;
const MAX_HORIZON_DAYS = 45;

// Orden dentro de un mismo día: ingresos → préstamos → gastos y ahorros
// recurrentes → pagos de tarjeta. El pago se evalúa con lo demás del día aplicado.
const KIND_ORDER = { income: 0, loan: 1, recurring_expense: 2, savings: 2, card_payment: 3 };
const EXPENSE_TYPES = ['expense', 'fixed_expense', 'variable_expense'];

const roundCents = (n) => Math.round(n * 100) / 100 || 0;

function addDaysISO(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

// Gasto recurrente cargado a la tarjeta `cardId`: no mueve el efectivo, engorda su pago.
function isCardCharge(template, cardId) {
  return EXPENSE_TYPES.includes(template.type) && template.cardId === cardId;
}

// Préstamo con una cuota que cobrar: activo, con fecha de pago, cuota y saldo.
// Mismos criterios que getDueLoanReminders.
function isScheduledLoan(debt) {
  return debt?.status === 'active' && !!debt.due_date
    && Number(debt.monthlyPayment) > 0 && Number(debt.currentBalance) > 0;
}

/**
 * Ocurrencias (fechas ISO) de una plantilla recurrente dentro de [fromISO, toISO],
 * ambos incluidos. Avanza desde `nextDate` con `advanceDate`, igual que
 * `materializeDue`. Las anteriores a `fromISO` se ignoran: las vencidas ya son
 * transacciones. Una plantilla inactiva no genera nada.
 * @returns {string[]}
 */
export function expandRecurring(template, fromISO, toISO) {
  if (!template?.active || !template.nextDate) return [];
  const out = [];
  let next = template.nextDate;
  for (let i = 0; i < MAX_STEPS && next <= toISO; i++) {
    if (next >= fromISO) out.push(next);
    next = advanceDate(next, template.frequency);
  }
  return out;
}

/**
 * Pago completo previsto de una tarjeta (se supone que se paga el saldo entero).
 *  - Estado cerrado sin pagar: en su fecha de pago, por `pendingBilled`. Si esa
 *    fecha ya pasó, el pago es HOY y va marcado `overdue`.
 *  - Estado cerrado ya pagado: en la fecha de pago del ciclo abierto, por `openCycle`
 *    más los gastos recurrentes cargados a la tarjeta hasta su próximo corte. (Con
 *    el estado cerrado sin pagar, esos cargos caen en el ciclo abierto y no lo tocan.)
 * Sin ciclo válido (no hay fecha) o sin nada que pagar devuelve null.
 * @returns {{ dateISO: string, amount: number, overdue: boolean } | null}
 */
export function getNextCardPayment(card, transactions, recurring, refDate) {
  if (!hasValidCardCycle(card)) return null;
  const todayISO = toISODate(refDate);
  const bal = getCardBalances(card, transactions, refDate);

  if (!bal.isPaid) {
    const due = bal.cycles.dueDateISO;
    return due >= todayISO
      ? { dateISO: due, amount: bal.pendingBilled, overdue: false }
      : { dateISO: todayISO, amount: bal.pendingBilled, overdue: true };
  }

  // El estado del ciclo abierto cierra en el próximo corte: suma lo ya consumido y
  // los cargos recurrentes de la tarjeta que caen hasta ese corte.
  const { nextCutoffISO } = bal.cycles;
  const scheduled = (recurring || []).reduce((sum, t) => {
    if (!isCardCharge(t, card.id)) return sum;
    return sum + (Number(t.amount) || 0) * expandRecurring(t, todayISO, nextCutoffISO).length;
  }, 0);
  const amount = bal.openCycle + scheduled;
  if (amount <= 0) return null;
  // Su pago es la primera fecha de pago posterior a ese corte (getCardCycles lo
  // resuelve tomando el corte como fecha de referencia).
  const { dueDateISO } = getCardCycles(card, new Date(nextCutoffISO + 'T00:00:00'));
  return { dateISO: dueDateISO, amount, overdue: false };
}

/**
 * Movimientos previstos del efectivo hasta el pago más lejano de las tarjetas,
 * con saldo corrido. Sin tarjetas con pago previsto, el horizonte es de 30 días.
 * @returns {{ horizonISO: string, startCash: number, events: object[], endCash: number,
 *             minCash: number, firstShortfall: object | null, skippedDebts: string[],
 *             paymentsBeyondHorizon: number }}
 */
export function getCashflowUntilCardDue({
  transactions, initialCashBalance, cards, recurring, debts, debtPayments, currency, refDate,
}) {
  const todayISO = toISODate(refDate);
  const startCash = getLiquidCash(transactions, initialCashBalance, cards);

  const cardPayments = [];
  for (const card of cards || []) {
    const p = getNextCardPayment(card, transactions || [], recurring || [], refDate);
    if (p) cardPayments.push({ card, ...p });
  }
  // Hasta el pago más lejano, con tope de 45 días; sin pagos previstos, 30 días.
  const farthestDue = cardPayments.reduce((max, p) => (p.dateISO > max ? p.dateISO : max), todayISO);
  const capISO = addDaysISO(todayISO, MAX_HORIZON_DAYS);
  const horizonISO = cardPayments.length
    ? (farthestDue < capISO ? farthestDue : capISO)
    : addDaysISO(todayISO, NO_CARD_HORIZON_DAYS);

  const raw = [];
  for (const t of recurring || []) {
    const isIncome = t.type === 'income';
    const isSavings = t.type === 'savings';
    if (!isIncome && !isSavings && !EXPENSE_TYPES.includes(t.type)) continue;
    const amount = Number(t.amount) || 0;
    if (amount <= 0) continue;
    // Gasto con tarjeta: no sale del banco hoy, ya va dentro del pago de su tarjeta.
    if (t.cardId && !isIncome && !isSavings) continue;
    const kind = isIncome ? 'income' : isSavings ? 'savings' : 'recurring_expense';
    for (const dateISO of expandRecurring(t, todayISO, horizonISO)) {
      raw.push({ dateISO, kind, label: t.description || '', amount: isIncome ? amount : -amount, sourceId: t.id });
    }
  }

  // Cuotas de préstamos activos. Las de otra moneda no se pueden sumar al efectivo
  // del perfil: se omiten y se devuelven en `skippedDebts` para avisarlo.
  const skippedDebts = [];
  for (const debt of debts || []) {
    if (!isScheduledLoan(debt)) continue;
    if ((debt.currency || 'DOP') !== currency) { skippedDebts.push(debt.id); continue; }
    const quota = Number(debt.monthlyPayment);
    let remaining = Number(debt.currentBalance);
    let dueISO = getNextLoanDueDate(debt, debtPayments, refDate);
    // La cuota se topa por el saldo que queda: la última se reduce y después no hay más.
    for (let i = 0; i < MAX_STEPS && dueISO && dueISO <= horizonISO && remaining > 0; i++) {
      const amount = Math.min(quota, remaining);
      raw.push({ dateISO: dueISO, kind: 'loan', label: debt.creditorName || '', amount: -amount, sourceId: debt.id });
      remaining = roundCents(remaining - amount);
      // La siguiente cuota se ancla al día del préstamo (no a la fecha anterior) y se
      // busca desde el mes que sigue a `dueISO`. getNextLoanDueDate puede haber
      // arrastrado un día 31 al 30 al saltar una cuota pagada; anclar desde el día
      // siguiente a esa fecha caería otra vez en el mismo mes.
      const [y, m] = dueISO.split('-').map(Number);
      dueISO = nextMonthlyOccurrence(debt.due_date, new Date(y, m, 1));
    }
  }

  let paymentsBeyondHorizon = 0;
  for (const p of cardPayments) {
    if (p.dateISO > horizonISO) { paymentsBeyondHorizon += 1; continue; }
    raw.push({
      dateISO: p.dateISO, kind: 'card_payment', label: p.card.name, amount: -p.amount,
      overdue: p.overdue, sourceId: p.card.id,
    });
  }

  // Array.sort es estable: los empates conservan el orden de inserción.
  raw.sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : KIND_ORDER[a.kind] - KIND_ORDER[b.kind]));

  let balance = startCash;
  let minCash = startCash;
  const events = raw.map((e) => {
    const shortfall = e.kind === 'card_payment' ? computeShortfall(balance, -e.amount).shortfall : 0;
    balance = roundCents(balance + e.amount);
    minCash = Math.min(minCash, balance);
    return { ...e, balanceAfter: balance, shortfall: roundCents(shortfall) };
  });

  return {
    horizonISO,
    startCash,
    events,
    endCash: balance,
    minCash,
    firstShortfall: events.find((e) => e.shortfall > 0) || null,
    skippedDebts,
    paymentsBeyondHorizon,
  };
}
