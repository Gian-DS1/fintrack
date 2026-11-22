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
import { getEffectiveAmount } from './calculations.js';
import { getLiquidCash, computeShortfall, getFirstDataMonth, getRealMoney } from '../stitch/screens/dashboard/selectors.js';

// Guarda contra plantillas con fechas absurdas: una semanal a 45 días son 7 pasos.
const MAX_STEPS = 400;
const NO_CARD_HORIZON_DAYS = 30;
const MAX_HORIZON_DAYS = 45;

// Orden dentro de un mismo día: ingresos → préstamos → gastos y ahorros
// recurrentes → pagos de tarjeta. El pago se evalúa con lo demás del día aplicado.
const KIND_ORDER = { income: 0, loan: 1, recurring_expense: 2, savings: 2, card_payment: 3 };
const EXPENSE_TYPES = ['expense', 'fixed_expense', 'variable_expense'];
const VARIABLE_TYPES = ['variable_expense', 'expense'];

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

// ─────────────────────────────────────────────────────────────────────────────
// Entrega 3 · Promedio mensual de gasto
// ─────────────────────────────────────────────────────────────────────────────

// Mínimo de días con datos para extrapolar un único mes parcial a un mes entero.
const MIN_PARTIAL_DAYS = 10;
const monthIndexOf = (y, m0) => y * 12 + m0;

/**
 * Promedio mensual de gasto de los últimos `months` meses COMPLETOS (sin el mes de
 * `refDate`), neto de cashback y con o sin tarjeta. Los meses anteriores al primer
 * dato no cuentan como meses en cero: con menos historial usa los que hay. Si el mes
 * del primer dato empezó después del día 1 es un mes parcial: se descarta cuando hay
 * otro mes completo y, si es el único, se prorratea por los días con datos (con menos
 * de 10 días no se extrapola: devuelve 0 meses). `prorateFirstMonth: false` usa ese mes
 * tal cual (para pagos únicos al mes, como los fijos, que no se escalan por días).
 * `categoryIds: null` = todas; un arreglo vacío = ninguna. `excludeTransactionIds` y
 * `excludeCategoryIds` sacan transacciones concretas o categorías enteras del promedio.
 * @returns {{ average: number, monthsUsed: number }}
 */
export function getAverageMonthlySpend(transactions, refDate, {
  months = 3, types = ['variable_expense', 'expense'], categoryIds = null,
  excludeTransactionIds = [], excludeCategoryIds = [], prorateFirstMonth = true,
} = {}) {
  const first = getFirstDataMonth(transactions);
  if (!first) return { average: 0, monthsUsed: 0 };
  const refIdx = monthIndexOf(refDate.getFullYear(), refDate.getMonth());
  const firstIdx = monthIndexOf(first.y, first.m);
  let startIdx = Math.max(firstIdx, refIdx - months);
  if (startIdx >= refIdx) return { average: 0, monthsUsed: 0 };

  // Día del primer dato: si es el mes de arranque y no empezó el día 1, es parcial.
  let firstISO = '';
  for (const t of transactions) if (t.date && (!firstISO || t.date < firstISO)) firstISO = t.date;
  const firstDay = Number(firstISO.slice(8, 10));
  let partialShare = 1;
  if (startIdx === firstIdx && firstDay > 1) {
    if (refIdx - startIdx > 1) {
      startIdx += 1;
    } else if (prorateFirstMonth) {
      const daysInMonth = new Date(first.y, first.m + 1, 0).getDate();
      const daysWithData = daysInMonth - firstDay + 1;
      if (daysWithData < MIN_PARTIAL_DAYS) return { average: 0, monthsUsed: 0 };
      partialShare = daysWithData / daysInMonth;
    }
  }
  const monthsUsed = refIdx - startIdx;

  const skipTx = new Set(excludeTransactionIds);
  const skipCat = new Set(excludeCategoryIds);
  let total = 0;
  for (const t of transactions) {
    if (!t.date || !types.includes(t.type)) continue;
    if (skipTx.has(t.id) || skipCat.has(t.categoryId)) continue;
    if (categoryIds && !categoryIds.includes(t.categoryId)) continue;
    const idx = monthIndexOf(Number(t.date.slice(0, 4)), Number(t.date.slice(5, 7)) - 1);
    if (idx < startIdx || idx >= refIdx) continue;
    total += getEffectiveAmount(t);
  }
  return { average: roundCents(total / monthsUsed / partialShare), monthsUsed };
}

const MONTHLY_FACTOR = { weekly: 52 / 12, biweekly: 26 / 12 };

/** Equivalente mensual de una plantilla recurrente: semanal × 52/12, quincenal × 26/12. */
export function monthlyEquivalent(template) {
  return (Number(template?.amount) || 0) * (MONTHLY_FACTOR[template?.frequency] ?? 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrega 3 · Proyección del dinero real a N meses
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CUT_PCT = 0.2;

// Último día del mes `k` meses después del de `refDate`, y su primer día.
function monthBounds(refDate, k) {
  const first = new Date(refDate.getFullYear(), refDate.getMonth() + k, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  return { first, firstISO: toISODate(first), lastISO: toISODate(last), daysInMonth: last.getDate() };
}

// Gasto variable «no programado» mensual que asume cada escenario (sin prorratear).
// `average` y `scheduled` ya vienen netos entre sí (promedio − recurrentes variables).
function scenarioVariableBase({ scenario, unscheduled, essentialUnscheduled, variableOverride, cutPct }) {
  const manual = Number.isFinite(variableOverride) && variableOverride >= 0 ? variableOverride : null;
  const current = manual ?? unscheduled;
  if (scenario === 'essential') return essentialUnscheduled;
  if (scenario === 'cuts') return roundCents(current * (1 - Math.min(1, Math.max(0, cutPct))));
  return current;
}

/**
 * Curva del dinero real a `months` meses: el punto 0 es el cierre del mes en curso
 * (solo cuenta desde hoy: la parte ya pasada está en las transacciones) y los
 * siguientes son meses completos, así que hay `months + 1` puntos. El dinero real
 * parte de `getRealMoney` y cada mes suma ingresos recurrentes y resta gastos y
 * ahorros recurrentes (con o sin tarjeta: en dinero real da igual el medio de
 * pago), cuotas de préstamos, el gasto variable del escenario y los «fijos no
 * programados» (promedio de fijos menos lo que ya cubren los recurrentes fijos).
 * Los gastos de promedio (variable y fijos no programados) se prorratean en el mes
 * en curso por los días que quedan, hoy incluido. Los intereses se ignoran.
 * Solo lee sus parámetros: simular no toca ningún store.
 *  - `scenario`: 'current' (promedio o corrección manual), 'essential' (promedio de
 *    `essentialCategoryIds`) o 'cuts' (base × (1 − cutPct)).
 *  - `excludedRecurringIds`: cancelaciones simuladas, válidas en todos los escenarios.
 *  - `variableOverride`: corrección manual del gasto variable NO programado (el promedio
 *    menos lo que ya cubren los recurrentes variables); no aplica a 'essential'.
 *  - `includeFixedUnscheduled`: false pone los fijos no programados a 0 en la curva
 *    (`base.fixedUnscheduled` conserva el importe para mostrarlo).
 *  - `debtPaymentCategoryIds`: categorías de pagos de préstamo antiguos sin enlace.
 * @returns {{ start: number,
 *   base: { variable: number,            // lo que asume el escenario, al mes
 *           average: number,             // promedio automático de variable
 *           variableScheduled: number,   // ya cubierto por recurrentes variables
 *           variableUnscheduled: number, // max(0, promedio − programado)
 *           variableMonthsUsed: number, fixedUnscheduled: number },
 *   points: Array<{ key: string, y: number, m: number, income: number, recurringOut: number,
 *                   loanOut: number, variableOut: number, fixedOut: number, realMoney: number }>,
 *   firstNegativeKey: string | null, minPoint: object, skippedDebts: string[],
 *   hasRecurringIncome: boolean }}
 */
export function projectRealMoney({
  transactions, initialCashBalance, cards, recurring, debts, debtPayments, currency, refDate,
  months = 12, scenario = 'current', excludedRecurringIds = [], variableOverride = null,
  essentialCategoryIds = [], cutPct = DEFAULT_CUT_PCT, debtPaymentCategoryIds = [], includeFixedUnscheduled = true,
}) {
  const todayISO = toISODate(refDate);
  const txs = transactions || [];
  const start = getRealMoney(txs, initialCashBalance, cards, refDate).realMoney;

  // Los pagos de préstamo ya hechos son transacciones fixed_expense, pero su cuota
  // futura ya se resta por separado (cuotas de préstamos): no deben alimentar los
  // promedios. Se excluyen por el enlace del pago y, para pagos antiguos sin enlace,
  // por las categorías que se pasan en `debtPaymentCategoryIds`.
  const loanFilter = {
    excludeTransactionIds: (debtPayments || []).map((p) => p?.transactionId).filter(Boolean),
    excludeCategoryIds: debtPaymentCategoryIds,
  };
  const average = getAverageMonthlySpend(txs, refDate, loanFilter);
  const essentialAverage = getAverageMonthlySpend(txs, refDate, { ...loanFilter, categoryIds: essentialCategoryIds }).average;

  // Los recurrentes de gasto variable se materializan como transacciones y ya están
  // dentro del promedio: se netean (todos, también los apagados en la simulación, para
  // que apagar uno sí quite su monto). En «solo lo esencial», solo los de esas categorías.
  const activeRecurring = (recurring || []).filter((t) => t?.active);
  const scheduledVariable = (onlyCategoryIds) => roundCents(activeRecurring
    .filter((t) => VARIABLE_TYPES.includes(t.type) && (!onlyCategoryIds || onlyCategoryIds.includes(t.categoryId)))
    .reduce((sum, t) => sum + monthlyEquivalent(t), 0));
  const variableScheduled = scheduledVariable(null);
  const essentialScheduled = scheduledVariable(essentialCategoryIds);
  const variableUnscheduled = roundCents(Math.max(0, average.average - variableScheduled));
  const variable = scenarioVariableBase({
    scenario,
    unscheduled: variableUnscheduled,
    essentialUnscheduled: roundCents(Math.max(0, essentialAverage - essentialScheduled)),
    variableOverride, cutPct,
  });

  // Fijos no programados: se netea contra TODOS los recurrentes fijos activos,
  // también los apagados en la simulación (apagar el alquiler no debe hacer
  // reaparecer un alquiler «no programado»).
  const scheduledFixed = activeRecurring
    .filter((t) => t.type === 'fixed_expense')
    .reduce((sum, t) => sum + monthlyEquivalent(t), 0);
  const fixedAverage = getAverageMonthlySpend(txs, refDate, {
    ...loanFilter, types: ['fixed_expense'], prorateFirstMonth: false,
  }).average;
  const fixedUnscheduled = roundCents(Math.max(0, fixedAverage - scheduledFixed));

  const excluded = new Set(excludedRecurringIds);
  const templates = activeRecurring.filter((t) => (
    !excluded.has(t.id) && (Number(t.amount) || 0) > 0
    && (t.type === 'income' || t.type === 'savings' || EXPENSE_TYPES.includes(t.type))
  ));

  // Cuotas de préstamos por mes ('YYYY-MM'). Mismo calendario que la lista de la
  // entrega 2: primera fecha pendiente y las siguientes ancladas al día del préstamo.
  const lastMonthISO = monthBounds(refDate, months).lastISO;
  const loanByMonth = new Map();
  const skippedDebts = [];
  for (const debt of debts || []) {
    if (!isScheduledLoan(debt)) continue;
    if ((debt.currency || 'DOP') !== currency) { skippedDebts.push(debt.id); continue; }
    const quota = Number(debt.monthlyPayment);
    let remaining = Number(debt.currentBalance);
    let dueISO = getNextLoanDueDate(debt, debtPayments, refDate);
    for (let i = 0; i < MAX_STEPS && dueISO && dueISO <= lastMonthISO && remaining > 0; i++) {
      const amount = Math.min(quota, remaining);
      const key = dueISO.slice(0, 7);
      loanByMonth.set(key, (loanByMonth.get(key) || 0) + amount);
      remaining = roundCents(remaining - amount);
      const [y, m] = dueISO.split('-').map(Number);
      dueISO = nextMonthlyOccurrence(debt.due_date, new Date(y, m, 1));
    }
  }

  const points = [];
  let realMoney = start;
  for (let k = 0; k <= months; k++) {
    const { first, firstISO, lastISO, daysInMonth } = monthBounds(refDate, k);
    const fromISO = k === 0 ? todayISO : firstISO;
    const share = k === 0 ? (daysInMonth - refDate.getDate() + 1) / daysInMonth : 1;

    let income = 0;
    let recurringOut = 0;
    for (const t of templates) {
      const total = (Number(t.amount) || 0) * expandRecurring(t, fromISO, lastISO).length;
      if (t.type === 'income') income += total;
      else recurringOut += total;
    }
    const key = firstISO.slice(0, 7);
    const loanOut = loanByMonth.get(key) || 0;
    const variableOut = roundCents(variable * share);
    const fixedOut = includeFixedUnscheduled ? roundCents(fixedUnscheduled * share) : 0;

    realMoney = roundCents(realMoney + income - recurringOut - loanOut - variableOut - fixedOut);
    points.push({
      key, y: first.getFullYear(), m: first.getMonth(),
      income: roundCents(income), recurringOut: roundCents(recurringOut),
      loanOut: roundCents(loanOut), variableOut, fixedOut, realMoney,
    });
  }

  return {
    start,
    base: {
      variable,
      average: average.average,
      variableScheduled,
      variableUnscheduled,
      variableMonthsUsed: average.monthsUsed,
      fixedUnscheduled,
    },
    points,
    firstNegativeKey: points.find((p) => p.realMoney < 0)?.key ?? null,
    minPoint: points.reduce((min, p) => (p.realMoney < min.realMoney ? p : min), points[0]),
    skippedDebts,
    hasRecurringIncome: activeRecurring.some((t) => t.type === 'income'),
  };
}
