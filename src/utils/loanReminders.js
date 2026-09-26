// FinTrack — Qué préstamos hay que avisar hoy por correo (lógica pura).
//
// Espejo de cardReminders.js para la tabla `debts`. Vive en src/utils por lo
// mismo: reutiliza nextMonthlyOccurrence —la fuente de verdad de la próxima
// fecha de pago de una deuda, compartida con el Dashboard y el calendario— y
// así queda cubierto por vitest, que solo mira src/**.
//
// Las reglas de antelación y de mora NO se redefinen aquí: se importan de
// cardReminders.js para que un solo correo no pueda aplicar dos criterios.
//
// Tres diferencias con las tarjetas:
//   1. El monto NO se deriva de transacciones: `monthlyPayment` (minimum_payment)
//      está almacenado, así que no hace falta leer transactions ni debt_payments.
//   2. Cada préstamo trae SU PROPIA moneda (debts.currency), no la del perfil.
//   3. No hay avisos de mora. nextMonthlyOccurrence siempre devuelve la próxima
//      ocurrencia HOY O DESPUÉS, así que `days` nunca sale negativo aquí: al
//      pasar el día de pago, la fecha rueda sola al mes siguiente. Además la
//      app no registra qué cuota se pagó, así que afirmar "venció ayer" sería
//      falso muy a menudo. resolveOffsetKey se sigue usando igual; su rama
//      days < 0 simplemente no se activa nunca para un préstamo.
//
// Este módulo es puro: no hace red, no lee env vars y no toca el DOM.

import { nextMonthlyOccurrence, advanceDate } from './recurrence.js';
import { resolveOffsetKey, DEFAULT_DAYS_BEFORE } from './cardReminders.js';

const MS_PER_DAY = 86_400_000;

/** Clave de deduplicación: un aviso por préstamo, fecha de pago y antelación. */
export function loanReminderKey(debtId, dueDateISO, offsetKey) {
  return `${debtId}|${dueDateISO}|${offsetKey}`;
}

/**
 * Suma los pagos realizados para una deuda dentro de una ventana de fechas (excluyente inicio, incluyente fin).
 *
 * @param {Array} payments - lista de pagos (debtId/debt_id, amount, date)
 * @param {string} debtId - id de la deuda
 * @param {string} startISO - fecha de inicio (excluyente, YYYY-MM-DD)
 * @param {string} endISO - fecha de fin (incluyente, YYYY-MM-DD)
 * @returns {number} suma total pagada
 */
export function getLoanPaymentsInWindow(payments = [], debtId, startISO, endISO) {
  if (!debtId || !Array.isArray(payments)) return 0;
  return payments.reduce((sum, p) => {
    if (!p) return sum;
    const id = p.debtId || p.debt_id;
    if (id !== debtId) return sum;
    const d = typeof p.date === 'string' ? p.date.slice(0, 10) : '';
    if (d > startISO && d <= endISO) {
      return sum + (Number(p.amount) || 0);
    }
    return sum;
  }, 0);
}

/**
 * Fecha de vencimiento anterior (1 mes antes de `dueDateISO`), respetando el
 * día-del-mes de la fecha ancla de la deuda y recortando a la longitud de mes.
 */
export function previousLoanMonthlyOccurrence(anchorISO, dueDateISO) {
  if (!anchorISO || !dueDateISO) return null;
  const [, , d0] = String(anchorISO).slice(0, 10).split('-').map(Number);
  const [cy, cm] = String(dueDateISO).slice(0, 10).split('-').map(Number);
  if (!d0 || !cy || !cm) return null;

  let py = cy;
  let pm = cm - 1;
  if (pm < 1) { pm = 12; py -= 1; }
  const lastDay = new Date(py, pm, 0).getDate();
  const day = Math.min(d0, lastDay);
  return `${py}-${String(pm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Determina si la cuota de un préstamo correspondiente a `dueDateISO` ya fue pagada.
 */
export function isLoanInstallmentPaid(debt, payments = [], dueDateISO) {
  if (!debt || !debt.due_date || !dueDateISO) return false;
  const quota = Number(debt.monthlyPayment) || 0;
  if (quota <= 0) return false;

  const prevDueISO = previousLoanMonthlyOccurrence(debt.due_date, dueDateISO);
  if (!prevDueISO) return false;

  const list = Array.isArray(payments) && payments.length
    ? payments
    : (Array.isArray(debt?.payments) ? debt.payments : []);

  const paidAmount = getLoanPaymentsInWindow(list, debt.id, prevDueISO, dueDateISO);
  return paidAmount >= (quota - 0.01);
}

/**
 * Próxima fecha de vencimiento pendiente de pago para un préstamo.
 * Si la cuota del ciclo actual ya fue pagada, avanza al mes siguiente.
 */
export function getNextLoanDueDate(debt, payments = [], refDate = new Date()) {
  if (!debt || !debt.due_date) return null;
  if (debt.status === 'paid_off') return null;
  if (debt.currentBalance !== undefined && Number(debt.currentBalance) <= 0) return null;

  let candidate = nextMonthlyOccurrence(debt.due_date, refDate);
  if (!candidate) return null;

  const list = Array.isArray(payments) && payments.length
    ? payments
    : (Array.isArray(debt?.payments) ? debt.payments : []);

  let guard = 0;
  while (candidate && isLoanInstallmentPaid(debt, list, candidate) && guard < 120) {
    candidate = advanceDate(candidate, 'monthly');
    guard += 1;
  }

  return candidate;
}

/**
 * Préstamos que toca avisar HOY para un usuario.
 * Soporta firma nueva: (debts, payments, refDate, daysBefore, alreadySent)
 * y firma previa: (debts, refDate, daysBefore, alreadySent)
 *
 * @param {Array}  debts                deudas en camelCase (ver mapDebtRow / useDebtStore)
 * @param {Array|Date} paymentsOrRefDate pagos realizados o fecha de referencia
 * @param {Date|number[]} refDateOrDaysBefore refDate o antelaciones configuradas
 * @param {number[]|Set} daysBeforeOrAlreadySent antelaciones o ya enviadas
 * @param {Set<string>} maybeAlreadySent claves ya enviadas (ver loanReminderKey)
 * @returns {Array} avisos ordenados por urgencia (lo más próximo primero)
 */
export function getDueLoanReminders(
  debts = [],
  paymentsOrRefDate = [],
  refDateOrDaysBefore = new Date(),
  daysBeforeOrAlreadySent = DEFAULT_DAYS_BEFORE,
  maybeAlreadySent = new Set(),
) {
  let payments;
  let refDate;
  let daysBefore;
  let alreadySent;

  if (paymentsOrRefDate instanceof Date || typeof paymentsOrRefDate === 'string') {
    // Firma legado: (debts, refDate, daysBefore, alreadySent)
    payments = [];
    refDate = paymentsOrRefDate instanceof Date ? paymentsOrRefDate : new Date(paymentsOrRefDate);
    daysBefore = refDateOrDaysBefore;
    alreadySent = daysBeforeOrAlreadySent instanceof Set ? daysBeforeOrAlreadySent : new Set();
  } else {
    // Nueva firma: (debts, payments, refDate, daysBefore, alreadySent)
    payments = Array.isArray(paymentsOrRefDate) ? paymentsOrRefDate : [];
    refDate = refDateOrDaysBefore instanceof Date ? refDateOrDaysBefore : new Date();
    daysBefore = daysBeforeOrAlreadySent;
    alreadySent = maybeAlreadySent instanceof Set ? maybeAlreadySent : new Set();
  }

  const days_ = Array.isArray(daysBefore) && daysBefore.length ? daysBefore : DEFAULT_DAYS_BEFORE;
  const today = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
  const out = [];

  for (const debt of debts) {
    if (!debt?.id) continue;
    if (debt.status !== 'active') continue;          // saldado o archivado
    if (!debt.due_date) continue;                     // sin fecha de pago declarada

    const amount = Number(debt.monthlyPayment) || 0;
    if (amount <= 0) continue;                        // sin cuota que cobrar

    const balance = Number(debt.currentBalance) || 0;
    if (balance <= 0) continue;                        // ya no se debe nada

    const dueDateISO = getNextLoanDueDate(debt, payments, refDate);
    if (!dueDateISO) continue;

    const due = new Date(dueDateISO + 'T00:00:00');
    const days = Math.round((due - today) / MS_PER_DAY);

    const offsetKey = resolveOffsetKey(days, days_);
    if (offsetKey === null) continue;
    if (alreadySent.has(loanReminderKey(debt.id, dueDateISO, offsetKey))) continue;

    out.push({
      debtId: debt.id,
      creditorName: debt.creditorName,
      amount,                                          // cuota mensual
      currentBalance: balance,                          // saldo restante (secundario)
      currency: debt.currency || 'DOP',
      dueDateISO,
      days,
      offsetKey,
      isOverdue: days < 0,
    });
  }

  return out.sort((a, b) => a.days - b.days);
}
