// FinTrack — Qué tarjetas hay que avisar hoy por correo (lógica pura).
//
// Lo consume el cron diario /api/cron/card-reminders. Vive en src/utils (no en
// api/) por dos razones: reutiliza getCardBalances —la única fuente de verdad
// de montos y fechas, compartida con el Dashboard y el calendario— y así queda
// cubierto por vitest, que solo mira src/**.
//
// Este módulo es puro: no hace red, no lee env vars y no toca el DOM.

import { getCardBalances } from './creditCards.js';

// Antelaciones por defecto: un aviso con tiempo para mover el dinero y otro
// de último recordatorio la víspera. El usuario puede cambiarlas en Ajustes.
export const DEFAULT_DAYS_BEFORE = [5, 1];

// Hasta cuántos días DESPUÉS del vencimiento se sigue avisando. Pasado ese
// punto ya no es un olvido: insistir a diario solo genera ruido.
export const OVERDUE_MAX_DAYS = 3;

// Las fechas de pago son día-del-mes, así que "hoy" depende de la zona del
// usuario. El cron corre en UTC; sin esto, un aviso podría irse un día corrido.
export const REMINDER_TIMEZONE = 'America/Santo_Domingo';

const MS_PER_DAY = 86_400_000;

/**
 * "Hoy" en `timeZone`, como Date cuyos componentes LOCALES (getFullYear/
 * getMonth/getDate) son los de esa zona. getCardCycles solo lee esos tres
 * getters, así que este Date "fachada" le da el día correcto sin arrastrar una
 * librería de zonas horarias. Intl con zona nombrada es nativo en Node 20.
 */
export function todayInZone(timeZone = REMINDER_TIMEZONE, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(get('year'), get('month') - 1, get('day'));
}

/** Clave de deduplicación: un aviso por tarjeta, ciclo y antelación. */
export function reminderKey(cardId, dueDateISO, offsetKey) {
  return `${cardId}|${dueDateISO}|${offsetKey}`;
}

/**
 * Decide el `offsetKey` de un aviso según los días que faltan, o null si hoy
 * no toca avisar. Separada de getDueReminders para poder testearla sola.
 *
 *   days > 0  → solo si está en las antelaciones configuradas
 *   days === 0 → siempre (vence hoy)
 *   days < 0  → a diario hasta OVERDUE_MAX_DAYS (mora)
 */
export function resolveOffsetKey(days, daysBefore = DEFAULT_DAYS_BEFORE) {
  if (days > 0) return daysBefore.includes(days) ? days : null;
  if (days === 0) return 0;
  return -days <= OVERDUE_MAX_DAYS ? days : null;
}

/**
 * Tarjetas que toca avisar HOY para un usuario.
 *
 * @param {Array}  cards        tarjetas en camelCase (cutoffDay, dueDay, payments…)
 * @param {Array}  transactions transacciones en camelCase (cardId, date, amount…)
 * @param {Date}   refDate      "hoy" en la zona del usuario (ver todayInZone)
 * @param {number[]} daysBefore antelaciones configuradas, p. ej. [5, 1]
 * @param {Set<string>} alreadySent claves ya enviadas (ver reminderKey)
 * @returns {Array} avisos ordenados por urgencia (lo más vencido primero)
 */
export function getDueReminders(
  cards = [],
  transactions = [],
  refDate = new Date(),
  daysBefore = DEFAULT_DAYS_BEFORE,
  alreadySent = new Set(),
) {
  const days_ = Array.isArray(daysBefore) && daysBefore.length ? daysBefore : DEFAULT_DAYS_BEFORE;
  const today = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
  const out = [];

  for (const card of cards) {
    if (!card?.id) continue;
    const bal = getCardBalances(card, transactions, refDate);

    // Nada que cobrar: pagada o sin saldo facturado. El ciclo abierto todavía
    // no vence, por eso se mira pendingBilled y no totalBalance.
    if (bal.isPaid || bal.pendingBilled <= 0) continue;

    const due = new Date(bal.cycles.dueDateISO + 'T00:00:00');
    const days = Math.round((due - today) / MS_PER_DAY);

    const offsetKey = resolveOffsetKey(days, days_);
    if (offsetKey === null) continue;
    if (alreadySent.has(reminderKey(card.id, bal.cycles.dueDateISO, offsetKey))) continue;

    out.push({
      cardId: card.id,
      cardName: card.name,
      bank: card.bank || '',
      amount: bal.pendingBilled,
      dueDateISO: bal.cycles.dueDateISO,
      days,
      offsetKey,
      isOverdue: days < 0,
      statementStartISO: bal.cycles.closedStartISO,
      statementEndISO: bal.cycles.closedEndISO,
    });
  }

  return out.sort((a, b) => a.days - b.days);
}
