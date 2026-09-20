// FinTrack — Plantilla del correo de recordatorio de pago de tarjetas.
//
// Puro: recibe los avisos ya calculados (ver src/utils/cardReminders.js) y
// devuelve { subject, html, text }. No hace red ni lee env vars.
//
// El texto va en español como constantes de este archivo y NO pasa por el
// runtime de i18n de React: ese runtime guarda idioma y moneda en variables de
// módulo, que en un lambda caliente se filtrarían entre usuarios.

// Colores fijos. En correo no se puede depender de prefers-color-scheme (Gmail
// lo elimina), así que se usa un tema claro, que degrada bien en clientes
// oscuros. Lo contrario no es cierto.
const INK = '#0f172a';
const MUTED = '#64748b';
const BORDER = '#e2e8f0';
const DANGER = '#dc2626';
const ACCENT = '#4f46e5';

const FONT = '-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** '2026-06-05' → '5 de junio de 2026'. Sin Intl: el ISO ya es la fecha local. */
export function formatDateEs(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${d} de ${MESES[m - 1]} de ${y}`;
}

/**
 * Monto con separador de miles y 2 decimales. La moneda se pasa SIEMPRE
 * explícita: nunca se infiere de un estado global (ver cabecera del archivo).
 */
export function formatMoney(amount, currency = 'DOP') {
  const n = Number(amount) || 0;
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  const withSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const symbol = currency === 'DOP' ? 'RD$' : currency === 'USD' ? 'US$' : `${currency} `;
  return `${n < 0 ? '-' : ''}${symbol}\u00A0${withSep}.${dec}`;
}

/**
 * Frase de urgencia. Se usa tras "Vence"/"Venció", así que la forma del pasado
 * ("ayer", "hace 2 días") tiene que encajar con el verbo en pasado.
 */
export function urgencyPhrase(days) {
  if (days > 1) return `en ${days} días`;
  if (days === 1) return 'mañana';
  if (days === 0) return 'hoy';
  if (days === -1) return 'ayer';
  return `hace ${-days} días`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function subjectFor(reminders, currency) {
  const [first] = reminders;
  const money = formatMoney(first.amount, currency).replace(/\u00A0/g, ' ');
  const extra = reminders.length > 1 ? ` (+${reminders.length - 1} más)` : '';
  if (first.days < 0) return `⚠️ Tu ${first.cardName} venció ${urgencyPhrase(first.days)} — ${money}${extra}`;
  if (first.days === 0) return `Tu ${first.cardName} vence HOY — ${money}${extra}`;
  return `Tu ${first.cardName} vence ${urgencyPhrase(first.days)} — ${money}${extra}`;
}

function cardBlockHtml(r, currency) {
  const overdue = r.days < 0;
  const badgeBg = overdue ? '#fef2f2' : r.days <= 1 ? '#fffbeb' : '#f8fafc';
  const badgeInk = overdue ? DANGER : r.days <= 1 ? '#b45309' : MUTED;
  const label = overdue ? `Venció ${urgencyPhrase(r.days)}` : `Vence ${urgencyPhrase(r.days)}`;
  const bank = r.bank ? ` · ${escapeHtml(r.bank)}` : '';

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:10px;margin:0 0 16px 0;">
      <tr><td style="padding:18px 20px;">
        <div style="font:600 15px/1.3 ${FONT};color:${INK};">
          ${escapeHtml(r.cardName)}<span style="font-weight:400;color:${MUTED};">${bank}</span>
        </div>
        <div style="font:700 30px/1.25 ${FONT};color:${overdue ? DANGER : INK};padding:10px 0 4px 0;">
          ${formatMoney(r.amount, currency)}
        </div>
        <div style="display:inline-block;background:${badgeBg};color:${badgeInk};border-radius:6px;padding:5px 10px;font:600 13px/1.2 ${FONT};">
          ${label} · ${formatDateEs(r.dueDateISO)}
        </div>
        <div style="font:400 13px/1.5 ${FONT};color:${MUTED};padding-top:12px;">
          Estado de cuenta del ${formatDateEs(r.statementStartISO)} al ${formatDateEs(r.statementEndISO)}
        </div>
      </td></tr>
    </table>`;
}

/**
 * Construye el correo de un usuario con TODOS sus avisos del día.
 *
 * @param {object} p
 * @param {Array}  p.reminders avisos de getDueReminders (ya ordenados por urgencia)
 * @param {string} p.currency  código ISO de la moneda del usuario
 * @param {string} p.appUrl    URL base de la app (enlace de vuelta)
 * @returns {{subject:string, html:string, text:string}|null} null si no hay avisos
 */
export function buildReminderEmail({ reminders = [], currency = 'DOP', appUrl = '' } = {}) {
  if (!reminders.length) return null;

  const total = reminders.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const cardsUrl = `${String(appUrl).replace(/\/$/, '')}/mis-finanzas?tab=cards`;
  const plural = reminders.length > 1;
  const intro = plural
    ? `Tienes ${reminders.length} tarjetas con pagos pendientes.`
    : 'Tienes una tarjeta con el pago próximo a vencer.';

  const totalRow = plural ? `
        <tr><td style="padding:0 28px 4px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid ${BORDER};">
            <tr>
              <td style="padding:14px 0 0 0;font:600 14px/1.3 ${FONT};color:${MUTED};">Total a pagar</td>
              <td align="right" style="padding:14px 0 0 0;font:700 18px/1.3 ${FONT};color:${INK};">${formatMoney(total, currency)}</td>
            </tr>
          </table>
        </td></tr>` : '';

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Recordatorio de pago</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;">
        <tr><td style="padding:28px 28px 8px 28px;">
          <div style="font:700 13px/1.2 ${FONT};color:${ACCENT};letter-spacing:.08em;text-transform:uppercase;">FinTrack</div>
          <h1 style="margin:10px 0 6px 0;font:700 22px/1.3 ${FONT};color:${INK};">Recordatorio de pago</h1>
          <p style="margin:0 0 20px 0;font:400 15px/1.55 ${FONT};color:${MUTED};">${intro}</p>
        </td></tr>
        <tr><td style="padding:0 28px;">
          ${reminders.map((r) => cardBlockHtml(r, currency)).join('')}
        </td></tr>${totalRow}
        <tr><td style="padding:22px 28px 6px 28px;">
          <a href="${cardsUrl}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;border-radius:8px;padding:13px 22px;font:600 15px/1 ${FONT};">Ver mis tarjetas</a>
        </td></tr>
        <tr><td style="padding:18px 28px 26px 28px;">
          <p style="margin:0 0 10px 0;font:400 13px/1.55 ${FONT};color:${MUTED};">
            El monto mostrado es el <strong style="color:${INK};">saldo total facturado y pendiente</strong>. El pago mínimo que exige tu banco puede ser menor; pagar el total evita intereses.
          </p>
          <p style="margin:0;font:400 12px/1.5 ${FONT};color:#94a3b8;">
            Recibes este aviso porque tienes los recordatorios activos en FinTrack. Puedes desactivarlos en Ajustes.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const plain = (s) => s.replace(/\u00A0/g, ' ');
  const lines = [
    'FinTrack — Recordatorio de pago',
    '',
    intro,
    '',
    ...reminders.map((r) => {
      const label = r.days < 0 ? `Venció ${urgencyPhrase(r.days)}` : `Vence ${urgencyPhrase(r.days)}`;
      return [
        `${r.cardName}${r.bank ? ` (${r.bank})` : ''}`,
        `  Monto a pagar: ${plain(formatMoney(r.amount, currency))}`,
        `  ${label} · ${formatDateEs(r.dueDateISO)}`,
        `  Estado de cuenta del ${formatDateEs(r.statementStartISO)} al ${formatDateEs(r.statementEndISO)}`,
        '',
      ].join('\n');
    }),
    ...(plural ? [`Total a pagar: ${plain(formatMoney(total, currency))}`, ''] : []),
    `Ver mis tarjetas: ${cardsUrl}`,
    '',
    'El monto mostrado es el saldo total facturado y pendiente. El pago mínimo',
    'que exige tu banco puede ser menor; pagar el total evita intereses.',
    '',
    'Recibes este aviso porque tienes los recordatorios activos en FinTrack.',
    'Puedes desactivarlos en Ajustes.',
  ];

  return { subject: subjectFor(reminders, currency), html, text: lines.join('\n') };
}
