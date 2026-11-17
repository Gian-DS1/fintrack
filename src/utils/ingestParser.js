// FinTrack — Registro automático de gastos: parsing puro.
//
// Convierte lo que mandan los canales de ingesta (/api/ingest) en campos de una
// transacción:
//   - Atajo de iOS con el disparador "Transacción" (Apple Pay): llega ya
//     estructurado (monto, comercio, tarjeta), pero el monto viene como TEXTO
//     con el formato regional del teléfono ("RD$1,250.00", "12,50 €").
//   - Correos/SMS de notificación del banco: llega el cuerpo crudo y hay que
//     extraer monto, comercio, últimos 4 dígitos y fecha.
//
// Funciones puras, sin React, stores ni red: las usa el endpoint serverless y
// se prueban en ingestParser.test.js. Las extensiones .js en los imports son
// obligatorias (este archivo corre también en Node, fuera de Vite).
import { normalize } from '../data/defaultCategories.js';

const MAX_DESCRIPTION = 120;

// Símbolo/código → código ISO. `$` a secas es ambiguo (DOP, USD, MXN…): se
// devuelve null y quien llama asume la moneda del perfil.
const CURRENCY_TOKENS = [
  [/RD\s?\$|\bDOP\b/i, 'DOP'],
  [/US\s?\$|U\$S|\bUSD\b/i, 'USD'],
  [/€|\bEUR\b/i, 'EUR'],
];

export function detectCurrency(text) {
  const s = String(text ?? '');
  for (const [re, code] of CURRENCY_TOKENS) if (re.test(s)) return code;
  return null;
}

/**
 * Texto o número → monto positivo redondeado a 2 decimales, o null.
 * Resuelve el separador decimal sin conocer el locale:
 *   - con "," y "." presentes, el ÚLTIMO es el decimal ("1,250.00" / "1.250,00");
 *   - solo ",": miles si agrupa de a 3 ("1,250"), decimal si no ("12,50");
 *   - solo ".": decimal, salvo que haya varios ("1.250.000" → miles).
 */
export function parseAmount(input) {
  if (typeof input === 'number') {
    return Number.isFinite(input) && input > 0 ? Math.round(input * 100) / 100 : null;
  }
  const digits = String(input ?? '').replace(/[^\d.,]/g, '').replace(/^[.,]+|[.,]+$/g, '');
  if (!digits) return null;

  const lastComma = digits.lastIndexOf(',');
  const lastDot = digits.lastIndexOf('.');
  let canonical;
  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandSep = decimalSep === ',' ? '.' : ',';
    canonical = digits.split(thousandSep).join('').replace(decimalSep, '.');
  } else if (lastComma !== -1) {
    const groupsOfThree = /^\d{1,3}(,\d{3})+$/.test(digits);
    canonical = groupsOfThree ? digits.split(',').join('') : digits.replace(',', '.');
  } else if (digits.split('.').length > 2) {
    canonical = digits.split('.').join('');
  } else {
    canonical = digits;
  }

  const value = Number(canonical);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}

/** Comercio → descripción limpia (sin HTML, sin espacios dobles, acotada). */
export function cleanMerchant(raw) {
  return String(raw ?? '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:*\-–·]+|[\s:*\-–·.,;]+$/g, '')
    .slice(0, MAX_DESCRIPTION);
}

// Entidades HTML que aparecen en correos en español. Decodificarlas importa:
// "transacci&oacute;n" sin decodificar no calza con ninguna palabra clave.
const NAMED_ENTITIES = {
  nbsp: ' ', amp: '&', lt: ' ', gt: ' ', quot: '"', apos: "'", dollar: '$', euro: '€',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü',
  iexcl: '¡', iquest: '¿', bull: '•', middot: '·',
};

function decodeEntity(match, body) {
  if (body[0] === '#') {
    const code = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    // < y > decodificados reabrirían la puerta al HTML que se acaba de quitar.
    if (!Number.isInteger(code) || code < 32 || code > 0x10ffff || code === 60 || code === 62) return ' ';
    return code === 160 ? ' ' : String.fromCodePoint(code);
  }
  return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? ' ';
}

/** Cuerpo de correo (HTML o texto) → texto plano con saltos de línea útiles. */
export function htmlToText(input) {
  return String(input ?? '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|td|th|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^<>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, decodeEntity)
    .replace(/[ \t\r]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

// Clasificación del mensaje. Se evalúa sobre el texto normalizado (minúsculas,
// sin acentos). El orden importa: un "consumo declinado" NO es un gasto.
//
// Las reglas exigen que la palabra clave esté ATADA a la transacción (o a un
// código numérico, en el caso del OTP). Una palabra suelta no basta: el pie de
// casi todo correo bancario dice "si no reconoce este consumo…", "nunca
// comparta su clave o token" o "consumos no autorizados", y con reglas laxas
// se descartarían todos los consumos legítimos.
const TX = '(?:consumo|compra|transaccion|cargo|pago)';
const SKIP_RULES = [
  ['declined', new RegExp(`${TX}[^\\n]{0,60}(declinad|rechazad|denegad|no (fue |ha sido )?aprobad|fallid)|(declinad|rechazad|denegad)[^\\n]{0,40}${TX}`)],
  ['refund', new RegExp(`(reverso|reversad|devolucion|reembolso|anulacion|refund)[^\\n]{0,40}(${TX}|\\bpor\\b)|${TX}[^\\n]{0,40}(reversad|anulad|devuelt)`)],
  ['otp', /(codigo|token|clave|pin|otp)[^\n]{0,60}(\bes\b|:)\s*\d{4,8}\b/],
  ['payment_or_income', /pago recibido|gracias por (su|tu) pago|pago (a|de) (su|tu) tarjeta|hemos recibido (su|tu) pago|deposito (recibido|realizado|acreditado|(a|en) (su|tu))|recibiste (un|una) (deposito|transferencia)|transferencia recibida|te (enviaron|transfirieron)|credito a (su|tu) cuenta|(pago de|deposito de) nomina/],
  // Sacar efectivo mueve dinero de la cuenta al bolsillo: no es un gasto.
  ['cash_withdrawal', /\bretiro\b|cajero automatico|avance de efectivo|\batm\b/],
];
const PURCHASE_RE = /consumo|compra|transaccion|cargo|pagaste|usaste|utilizaste|uso de (su|tu) tarjeta|pago (en|con)|purchase|charged|spent|payment (at|to)/;

const CURRENCY_PREFIX = '(?:RD\\s?\\$|US\\s?\\$|U\\$S|USD|DOP|EUR|€|\\$)';
const NUMBER = '\\d[\\d.,]*';
const AMOUNT_LABELED_RE = new RegExp(`(?:monto|valor|importe|total|amount)[^\\S\\n]*:?[^\\S\\n]*\\n?[^\\S\\n]*(${CURRENCY_PREFIX}?\\s?${NUMBER}(?:\\s?(?:DOP|USD|EUR))?)`, 'i');
const AMOUNT_PREFIXED_RE = new RegExp(`(${CURRENCY_PREFIX}\\s?${NUMBER})`, 'gi');
const AMOUNT_SUFFIXED_RE = new RegExp(`(${NUMBER}\\s?(?:DOP|USD|EUR))\\b`, 'gi');
// Cifras que NO son el consumo: el banco suele incluir el saldo disponible, el
// límite o los puntos en el mismo correo. Se mira qué palabra precede a la cifra.
const NOT_THE_AMOUNT_RE = /(disponible|balance|saldo|limite( de credito)?|puntos|millas|cashback|minimo)[^\d\n]{0,12}$/;

// Primer monto del texto que no sea un saldo. Devuelve el texto de la cifra.
function findAmount(text) {
  const labeled = text.match(AMOUNT_LABELED_RE);
  if (labeled) return labeled[1];
  for (const re of [AMOUNT_PREFIXED_RE, AMOUNT_SUFFIXED_RE]) {
    for (const m of text.matchAll(re)) {
      const before = normalize(text.slice(Math.max(0, m.index - 40), m.index));
      if (!NOT_THE_AMOUNT_RE.test(before)) return m[1];
    }
  }
  return null;
}
const CURRENCY_LABELED_RE = /moneda[^\S\n]*:?[^\S\n]*\n?[^\S\n]*(RD\s?\$|US\s?\$|DOP|USD|EUR)/i;

// Dos niveles: "Comercio:" es inequívoco; "Descripción:"/"Detalle:" a veces
// traen "Consumo aprobado" y solo se usan si no hay una etiqueta mejor.
const LABEL_VALUE = '[^\\S\\n]*:?[^\\S\\n]*\\n?[^\\S\\n]*([^\\n]+)';
const MERCHANT_LABELED_RES = [
  new RegExp(`(?:comercio|establecimiento|negocio|merchant)${LABEL_VALUE}`, 'i'),
  new RegExp(`(?:lugar|localidad|descripci[oó]n|detalle|concepto)${LABEL_VALUE}`, 'i'),
];
// Correos sin saltos de línea ("Comercio: UBER Monto: US$12.50 Fecha: …"): el
// valor termina donde empieza la siguiente etiqueta.
const NEXT_LABEL_RE = /\s+(?:monto|valor|importe|total|fecha|hora|tarjeta|moneda|estado|tipo|referencia|autorizaci[oó]n|comercio|amount|date|card)\s*:/i;

function findLabeledMerchant(text) {
  for (const re of MERCHANT_LABELED_RES) {
    const m = text.match(re);
    const value = m ? cleanMerchant(m[1].split(NEXT_LABEL_RE)[0]) : '';
    if (value) return value;
  }
  return '';
}
// "…por RD$500.00 en SUPERMERCADO NACIONAL el 17/11/2026": el comercio empieza
// en mayúscula o dígito (evita "en su tarjeta") y corta en el siguiente conector.
const MERCHANT_INLINE_RE = /\b(?:en|at)\s+([A-Z0-9][^\n,;]*?)(?=\s+(?:el|por|con|on|for|a las|fecha|d[ií]a)\b|\s+\d{1,2}[/-]\d{1,2}|[,;\n]|\.\s|\.$|$)/g;

// Primer "en X" que sea de verdad un comercio: "terminada en 1234" también
// calza con el patrón, así que se exige que X tenga al menos una letra.
function findInlineMerchant(text) {
  for (const m of text.matchAll(MERCHANT_INLINE_RE)) {
    if (/[A-Za-z]/.test(m[1])) return m[1];
  }
  return null;
}

// Los enmascarados usan exactamente dos caracteres de máscara pegados a los
// dígitos ("**1234" dentro de "****-****-****-1234"): un cuantificador abierto
// aquí vuelve la búsqueda cuadrática ante una línea larga de asteriscos.
const LAST4_RE = /(?:[*xX•]{2}|terminad[ao] en|termina en|ending in|finaliza en)[\s\-#]{0,3}(\d{4})\b/;

const pad2 = (n) => String(n).padStart(2, '0');

function isValidDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Primera fecha del texto → 'YYYY-MM-DD' (formato local dd/mm/aaaa) o null. */
export function parseDate(text) {
  const s = String(text ?? '');
  const iso = s.match(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/);
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    return isValidDate(y, m, d) ? `${y}-${pad2(m)}-${pad2(d)}` : null;
  }
  const dmy = s.match(/(?<!\d)(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})(?!\d)/);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    const y = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    return isValidDate(y, m, d) ? `${y}-${pad2(m)}-${pad2(d)}` : null;
  }
  return null;
}

/**
 * Cuerpo de una notificación bancaria (correo, SMS o push) → campos del gasto.
 *
 * @returns {{ kind: 'purchase', amount: number, currency: string|null,
 *             merchant: string, last4: string|null, date: string|null }
 *          | { kind: 'skip', reason: string }}
 *   `skip` cubre lo que NO debe registrarse: rechazos, reversos, códigos OTP,
 *   pagos a la tarjeta, depósitos y correos sin señal de consumo (promos).
 */
export function parseNotificationText(raw) {
  const text = htmlToText(raw);
  if (!text) return { kind: 'skip', reason: 'empty' };

  const flat = normalize(text);
  for (const [reason, re] of SKIP_RULES) {
    if (re.test(flat)) return { kind: 'skip', reason };
  }
  if (!PURCHASE_RE.test(flat)) return { kind: 'skip', reason: 'not_a_purchase' };

  const amountText = findAmount(text);
  const amount = amountText ? parseAmount(amountText) : null;
  if (!amount) return { kind: 'skip', reason: 'no_amount' };

  const currencyLabel = text.match(CURRENCY_LABELED_RE);
  const currency = detectCurrency(amountText) || (currencyLabel ? detectCurrency(currencyLabel[1]) : null);

  const merchant = findLabeledMerchant(text) || cleanMerchant(findInlineMerchant(text));
  const last4Match = text.match(LAST4_RE);

  return {
    kind: 'purchase',
    amount,
    currency,
    merchant,
    last4: last4Match ? last4Match[1] : null,
    date: parseDate(text),
  };
}

/**
 * Resuelve a qué tarjeta de FinTrack corresponde un consumo.
 *   1. Por últimos 4 dígitos (dato del correo, o incluidos en el nombre que da
 *      Wallet: "Visa ••1234") contra `card.last4`.
 *   2. Por nombre: igualdad o contención normalizada contra el nombre de la
 *      tarjeta y contra "banco + nombre". Si empatan varias, gana el nombre más
 *      largo; un empate real devuelve null (mejor sin tarjeta que la equivocada).
 *
 * @param {Array<{id:string,name:string,bank?:string,last4?:string|null}>} cards
 * @param {{ name?: string, last4?: string|null }} hint
 * @returns {object|null} la tarjeta, o null (débito/efectivo o sin coincidencia)
 */
export function matchCard(cards = [], { name, last4 } = {}) {
  const digits = (/^\d{4}$/.test(String(last4 ?? '')) ? String(last4) : null)
    || ((typeof name === 'string' ? name : '').match(/(\d{4})\s*$/) || [])[1] || null;
  if (digits) {
    const byDigits = cards.filter((c) => c.last4 && c.last4 === digits);
    if (byDigits.length === 1) return byDigits[0];
  }

  const q = normalize(typeof name === 'string' ? name : '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (q.length < 3) return null;

  // Puntaje: coincidencia exacta > contención; a igual tipo, el nombre más largo.
  let best = null;
  let bestScore = 0;
  let tie = false;
  for (const card of cards) {
    const cardName = normalize(card.name);
    const full = normalize(`${card.bank || ''} ${card.name}`).trim();
    if (cardName.length < 3) continue;
    const exact = q === cardName || q === full;
    const contains = q.includes(cardName) || cardName.includes(q) || full.includes(q);
    if (!exact && !contains) continue;
    const score = (exact ? 1000 : 0) + cardName.length;
    if (score > bestScore) { best = card; bestScore = score; tie = false; }
    else if (score === bestScore) tie = true;
  }
  if (tie || !best) return null;
  // Si se conocen los 4 dígitos y los de la mejor candidata son otros, es otra
  // tarjeta (quizá una que no está en FinTrack): mejor ninguna que la equivocada.
  if (digits && best.last4 && best.last4 !== digits) return null;
  return best;
}

/**
 * Fecha del consumo a guardar: la reportada si es plausible, si no "hoy".
 * Un correo viejo reenviado o una fecha mal leída (mm/dd) no debe caer en otro
 * mes del presupuesto, así que solo se acepta el rango [hoy-31d, hoy+1d].
 */
export function resolveDate(candidate, todayISO) {
  if (!candidate || !/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return todayISO;
  const diffDays = (Date.parse(`${todayISO}T00:00:00Z`) - Date.parse(`${candidate}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(diffDays) && diffDays >= -1 && diffDays <= 31 ? candidate : todayISO;
}
