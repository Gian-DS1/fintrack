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

import { nextMonthlyOccurrence } from './recurrence.js';
import { resolveOffsetKey, DEFAULT_DAYS_BEFORE } from './cardReminders.js';

const MS_PER_DAY = 86_400_000;

/** Clave de deduplicación: un aviso por préstamo, fecha de pago y antelación. */
export function loanReminderKey(debtId, dueDateISO, offsetKey) {
  return `${debtId}|${dueDateISO}|${offsetKey}`;
}

/**
 * Préstamos que toca avisar HOY para un usuario.
 *
 * @param {Array}  debts       deudas en camelCase (ver mapDebtRow / useDebtStore)
 * @param {Date}   refDate     "hoy" en la zona del usuario (ver todayInZone)
 * @param {number[]} daysBefore antelaciones configuradas, p. ej. [5, 1]
 * @param {Set<string>} alreadySent claves ya enviadas (ver loanReminderKey)
 * @returns {Array} avisos ordenados por urgencia (lo más próximo primero)
 */
export function getDueLoanReminders(
  debts = [],
  refDate = new Date(),
  daysBefore = DEFAULT_DAYS_BEFORE,
  alreadySent = new Set(),
) {
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

    const dueDateISO = nextMonthlyOccurrence(debt.due_date, refDate);
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
