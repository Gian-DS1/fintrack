// FinTrack — Plantilla del correo de recordatorio de pago (tarjetas y préstamos).
//
// Puro: recibe los avisos ya calculados (ver src/utils/cardReminders.js y
// src/utils/loanReminders.js) y devuelve { subject, html, text }. No hace red
// ni lee env vars.
//
// El texto va en español como constantes de este archivo y NO pasa por el
// runtime de i18n de React: ese runtime guarda idioma y moneda en variables de
// módulo, que en un lambda caliente se filtrarían entre usuarios.
//
// Un usuario puede tener SOLO tarjetas, SOLO préstamos, o ambos en el mismo
// correo. Con `loans` vacío el correo sale igual que antes de esta función
// crecer: nadie que solo tenga tarjetas nota el cambio.

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

/**
 * Agrega tarjetas + préstamos por moneda. Las tarjetas usan la moneda del
 * perfil; cada préstamo trae la suya propia (debts.currency). Sumar RD$ con
 * US$ daría un número falso, así que un total único solo tiene sentido cuando
 * TODO comparte una sola moneda; si no, se devuelven subtotales por moneda.
 *
 * @returns {{mixed:boolean, currency:string, total:number,
 *            subtotals:Array<{currency:string,total:number}>}}
 */
function computeTotals(reminders, loans, currency) {
  const byCurrency = new Map();
  const add = (cur, amount) => byCurrency.set(cur, (byCurrency.get(cur) || 0) + (Number(amount) || 0));
  for (const r of reminders) add(currency, r.amount);
  for (const l of loans) add(l.currency || 'DOP', l.amount);

  const entries = [...byCurrency.entries()].map(([c, total]) => ({ currency: c, total }));
  // Orden estable: la moneda del perfil primero, el resto alfabético.
  entries.sort((a, b) => {
    if (a.currency === currency) return -1;
    if (b.currency === currency) return 1;
    return a.currency.localeCompare(b.currency);
  });

  return {
    mixed: entries.length > 1,
    currency: entries[0]?.currency || currency,
    total: entries[0]?.total || 0,
    subtotals: entries,
  };
}

function subjectFor(reminders, loans, currency) {
  const items = [
    ...reminders.map((r) => ({ days: r.days, name: r.cardName, amount: r.amount, cur: currency, kind: 0 })),
    ...loans.map((l) => ({ days: l.days, name: l.creditorName, amount: l.amount, cur: l.currency || 'DOP', kind: 1 })),
  ].sort((a, b) => a.days - b.days || a.kind - b.kind);

  const [first] = items;
  const money = formatMoney(first.amount, first.cur).replace(/\u00A0/g, ' ');
  const extra = items.length > 1 ? ` (+${items.length - 1} más)` : '';
  if (first.days < 0) return `⚠️ Tu ${first.name} venció ${urgencyPhrase(first.days)} — ${money}${extra}`;
  if (first.days === 0) return `Tu ${first.name} vence HOY — ${money}${extra}`;
  return `Tu ${first.name} vence ${urgencyPhrase(first.days)} — ${money}${extra}`;
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
 * Bloque de un préstamo. Espejo de cardBlockHtml, sin período de estado de
 * cuenta (no aplica a un préstamo) y con el saldo restante como pie. La
 * moneda sale SIEMPRE de `l.currency`, nunca de la del perfil.
 */
function loanBlockHtml(l) {
  const overdue = l.days < 0;
  const badgeBg = overdue ? '#fef2f2' : l.days <= 1 ? '#fffbeb' : '#f8fafc';
  const badgeInk = overdue ? DANGER : l.days <= 1 ? '#b45309' : MUTED;
  const label = overdue ? `Venció ${urgencyPhrase(l.days)}` : `Vence ${urgencyPhrase(l.days)}`;
  const cur = l.currency || 'DOP';

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:10px;margin:0 0 16px 0;">
      <tr><td style="padding:18px 20px;">
        <div style="font:600 15px/1.3 ${FONT};color:${INK};">${escapeHtml(l.creditorName)}</div>
        <div style="font:700 30px/1.25 ${FONT};color:${overdue ? DANGER : INK};padding:10px 0 4px 0;">
          ${formatMoney(l.amount, cur)}<span style="font:400 13px/1.3 ${FONT};color:${MUTED};">&nbsp;cuota mensual</span>
        </div>
        <div style="display:inline-block;background:${badgeBg};color:${badgeInk};border-radius:6px;padding:5px 10px;font:600 13px/1.2 ${FONT};">
          ${label} · ${formatDateEs(l.dueDateISO)}
        </div>
        <div style="font:400 13px/1.5 ${FONT};color:${MUTED};padding-top:12px;">
          Saldo restante: ${formatMoney(l.currentBalance, cur)}
        </div>
      </td></tr>
    </table>`;
}

function sectionTitleHtml(text) {
  return `
    <div style="font:700 12px/1.2 ${FONT};color:${MUTED};letter-spacing:.08em;text-transform:uppercase;padding:4px 0 12px 0;">${text}</div>`;
}

function totalsHtml(totals, itemCount) {
  if (itemCount <= 1) return '';
  if (!totals.mixed) {
    return `
        <tr><td style="padding:0 28px 4px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid ${BORDER};">
            <tr>
              <td style="padding:14px 0 0 0;font:600 14px/1.3 ${FONT};color:${MUTED};">Total a pagar</td>
              <td align="right" style="padding:14px 0 0 0;font:700 18px/1.3 ${FONT};color:${INK};">${formatMoney(totals.total, totals.currency)}</td>
            </tr>
          </table>
        </td></tr>`;
  }
  const rows = totals.subtotals.map((s, i) => `
            <tr>
              <td style="padding:${i === 0 ? 14 : 4}px 0 0 0;font:600 14px/1.3 ${FONT};color:${MUTED};">Total en ${s.currency}</td>
              <td align="right" style="padding:${i === 0 ? 14 : 4}px 0 0 0;font:700 18px/1.3 ${FONT};color:${INK};">${formatMoney(s.total, s.currency)}</td>
            </tr>`).join('');
  return `
        <tr><td style="padding:0 28px 4px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid ${BORDER};">
            ${rows}
          </table>
        </td></tr>`;
}

/**
 * Construye el correo de un usuario con TODOS sus avisos del día (tarjetas y
 * préstamos).
 *
 * @param {object} p
 * @param {Array}  p.reminders avisos de tarjetas (getDueReminders), ya ordenados por urgencia
 * @param {Array}  p.loans     avisos de préstamos (getDueLoanReminders), ya ordenados por urgencia
 * @param {string} p.currency  código ISO de la moneda del PERFIL — solo aplica a las tarjetas
 * @param {string} p.appUrl    URL base de la app (enlace de vuelta)
 * @returns {{subject:string, html:string, text:string}|null} null si no hay avisos
 */
export function buildReminderEmail({ reminders = [], loans = [], currency = 'DOP', appUrl = '' } = {}) {
  if (!reminders.length && !loans.length) return null;

  const base = String(appUrl).replace(/\/$/, '');
  const cardsUrl = `${base}/mis-finanzas?tab=cards`;
  const debtsUrl = `${base}/mis-finanzas?tab=debts`;

  const itemCount = reminders.length + loans.length;
  const bothSections = reminders.length > 0 && loans.length > 0;
  const totals = computeTotals(reminders, loans, currency);

  let intro;
  if (!loans.length) {
    intro = reminders.length > 1
      ? `Tienes ${reminders.length} tarjetas con pagos pendientes.`
      : 'Tienes una tarjeta con el pago próximo a vencer.';
  } else if (!reminders.length) {
    intro = loans.length > 1
      ? `Tienes ${loans.length} préstamos con cuotas próximas a vencer.`
      : 'Tienes un préstamo con la cuota próxima a vencer.';
  } else {
    intro = `Tienes ${itemCount} pagos próximos a vencer: ${reminders.length} en tarjetas y ${loans.length} en préstamos.`;
  }

  const totalRow = totalsHtml(totals, itemCount);

  const cardsCta = reminders.length ? `
          <a href="${cardsUrl}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;border-radius:8px;padding:13px 22px;font:600 15px/1 ${FONT};">Ver mis tarjetas</a>` : '';
  const loansCta = loans.length ? `
          <a href="${debtsUrl}" style="display:inline-block;background:#ffffff;color:${ACCENT};border:1px solid ${BORDER};text-decoration:none;border-radius:8px;padding:12px 22px;font:600 15px/1 ${FONT};${reminders.length ? 'margin-left:8px;' : ''}">Ver mis préstamos</a>` : '';

  const cardsFooter = reminders.length ? `
          <p style="margin:0 0 10px 0;font:400 13px/1.55 ${FONT};color:${MUTED};">
            El monto de tarjeta mostrado es el <strong style="color:${INK};">saldo total facturado y pendiente</strong>. El pago mínimo que exige tu banco puede ser menor; pagar el total evita intereses.
          </p>` : '';
  const loansFooter = loans.length ? `
          <p style="margin:0 0 10px 0;font:400 13px/1.55 ${FONT};color:${MUTED};">
            El monto de préstamo mostrado es la <strong style="color:${INK};">cuota mensual</strong> que registraste; el saldo restante es lo que aún debes.
          </p>` : '';

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
          ${bothSections ? sectionTitleHtml('Tarjetas') : ''}
          ${reminders.map((r) => cardBlockHtml(r, currency)).join('')}
          ${bothSections ? sectionTitleHtml('Préstamos') : ''}
          ${loans.map((l) => loanBlockHtml(l)).join('')}
        </td></tr>${totalRow}
        <tr><td style="padding:22px 28px 6px 28px;">
          ${cardsCta}${loansCta}
        </td></tr>
        <tr><td style="padding:18px 28px 26px 28px;">
          ${cardsFooter}${loansFooter}
          <p style="margin:0;font:400 12px/1.5 ${FONT};color:#94a3b8;">
            Recibes este aviso porque tienes los recordatorios activos en FinTrack. Puedes desactivarlos en Ajustes.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const plain = (s) => s.replace(/\u00A0/g, ' ');

  const totalLines = itemCount > 1
    ? (totals.mixed
      ? totals.subtotals.map((s) => `Total en ${s.currency}: ${plain(formatMoney(s.total, s.currency))}`)
      : [`Total a pagar: ${plain(formatMoney(totals.total, totals.currency))}`])
    : [];

  const lines = [
    'FinTrack — Recordatorio de pago',
    '',
    intro,
    '',
    ...(bothSections ? ['TARJETAS', ''] : []),
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
    ...(bothSections ? ['PRÉSTAMOS', ''] : []),
    ...loans.map((l) => {
      const label = l.days < 0 ? `Venció ${urgencyPhrase(l.days)}` : `Vence ${urgencyPhrase(l.days)}`;
      const cur = l.currency || 'DOP';
      return [
        l.creditorName,
        `  Cuota mensual: ${plain(formatMoney(l.amount, cur))}`,
        `  ${label} · ${formatDateEs(l.dueDateISO)}`,
        `  Saldo restante: ${plain(formatMoney(l.currentBalance, cur))}`,
        '',
      ].join('\n');
    }),
    ...(totalLines.length ? [...totalLines, ''] : []),
    ...(reminders.length ? [`Ver mis tarjetas: ${cardsUrl}`] : []),
    ...(loans.length ? [`Ver mis préstamos: ${debtsUrl}`] : []),
    '',
    ...(reminders.length ? [
      'El monto de tarjeta mostrado es el saldo total facturado y pendiente. El pago',
      'mínimo que exige tu banco puede ser menor; pagar el total evita intereses.',
      '',
    ] : []),
    ...(loans.length ? [
      'El monto de préstamo mostrado es la cuota mensual que registraste; el saldo',
      'restante es lo que aún debes.',
      '',
    ] : []),
    'Recibes este aviso porque tienes los recordatorios activos en FinTrack.',
    'Puedes desactivarlos en Ajustes.',
  ];

  return { subject: subjectFor(reminders, loans, currency), html, text: lines.join('\n') };
}
