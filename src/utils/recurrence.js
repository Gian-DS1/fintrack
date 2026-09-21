// FinTrack — Lógica pura de recurrencia

import { toISODate } from './formatters.js';

/**
 * Avanza una fecha ISO (YYYY-MM-DD) según la frecuencia.
 * - weekly: +7 días, biweekly: +14 días.
 * - monthly: mismo día del mes siguiente, recortado a la longitud del mes
 *   destino (ej. 31 ene → 28/29 feb).
 */
export function advanceDate(iso, frequency) {
  const [y, m, d] = iso.split('-').map(Number);
  if (frequency === 'weekly' || frequency === 'biweekly') {
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + (frequency === 'weekly' ? 7 : 14));
    return toISODate(dt);
  }
  // monthly
  let ny = y;
  let nm = m + 1;
  if (nm > 12) { nm = 1; ny += 1; }
  const lastDay = new Date(ny, nm, 0).getDate();
  const day = Math.min(d, lastDay);
  return `${ny}-${String(nm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Próxima ocurrencia MENSUAL (hoy o después) de una fecha ancla, conservando su
 * día-del-mes y recortándolo a la longitud de cada mes destino (día 31 → 30 o
 * 28/29 según el mes). Si la fecha ancla aún no ha pasado se devuelve tal cual
 * (no se adelanta a un ciclo anterior); si ya pasó, se rueda mes a mes hasta la
 * primera ocurrencia que caiga hoy o después.
 *
 * Ancla la "próxima fecha de pago" de una deuda al día actual: cuando el día de
 * pago pasa, la próxima ocurrencia avanza sola al mes siguiente sin reescribir la
 * base de datos. Es el espejo, para fechas absolutas, de lo que getCardCycles
 * hace con el día de corte/pago (día-del-mes) de las tarjetas.
 *
 * @param {string} anchorISO - fecha ancla YYYY-MM-DD (o con hora; se recorta).
 * @param {Date}   refDate   - fecha de referencia (hoy).
 * @returns {string|null} ISO de la próxima ocurrencia, o null si no hay ancla válida.
 */
export function nextMonthlyOccurrence(anchorISO, refDate = new Date()) {
  if (!anchorISO) return null;
  const [y0, m0, d0] = String(anchorISO).slice(0, 10).split('-').map(Number);
  if (!y0 || !m0 || !d0) return null;

  const todayISO = toISODate(refDate);
  const build = (year, month1) => {
    // Día 0 del mes siguiente = último día del mes actual (recorta el 31, 30, 29).
    const lastDay = new Date(year, month1, 0).getDate();
    const day = Math.min(d0, lastDay);
    return `${year}-${String(month1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  let year = y0;
  let month1 = m0; // 1-based
  let candidate = build(year, month1);
  let guard = 0;
  while (candidate < todayISO && guard < 1200) {
    month1 += 1;
    if (month1 > 12) { month1 = 1; year += 1; }
    candidate = build(year, month1);
    guard += 1;
  }
  return candidate;
}
