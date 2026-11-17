// FinTrack — Registro automático de gastos: de "lo que llegó" a "la fila a guardar".
//
// Orquesta el parser (ingestParser.js) con lo que la app YA sabe del usuario:
// sus categorías (palabras clave), su historial (memoria de transacciones), sus
// tarjetas (nombre, últimos 4, reglas de cashback) y su moneda. Es la misma
// inteligencia del formulario manual, aplicada sin que el usuario teclee nada.
//
// Pura y sin red: el endpoint /api/ingest le pasa los datos ya leídos y solo
// persiste el resultado. Probada en ingestBuild.test.js.
import { autoCategorize } from '../data/defaultCategories.js';
import { suggestFromHistory } from '../data/transactionMemory.js';
import { computeCashback } from './creditCards.js';
import {
  parseAmount, parseDate, parseNotificationText, detectCurrency,
  cleanMerchant, matchCard, resolveDate,
} from './ingestParser.js';

export const INGEST_SOURCES = ['shortcut', 'email'];
const EXPENSE_TYPES = new Set(['expense', 'fixed_expense', 'variable_expense']);
const HARD_SKIPS = new Set(['declined', 'refund', 'otp', 'payment_or_income', 'cash_withdrawal']);
const FALLBACK_DESCRIPTION = { shortcut: 'Apple Pay', email: 'Consumo con tarjeta' };

/**
 * @param {object} input  cuerpo de la petición: { amount?, merchant?, card?, last4?, date?, text?, source?, id? }
 * @param {object} ctx
 * @param {Array}  ctx.categories   [{ id, name, type, keywords, isActive }]
 * @param {Array}  ctx.cards        [{ id, name, bank, last4, cashbackRules }]
 * @param {Array}  ctx.history      transacciones recientes [{ description, categoryId, cardId, date }]
 * @param {string} ctx.currency     moneda del perfil (ISO)
 * @param {string} ctx.todayISO     "hoy" en la zona del usuario
 * @returns {{ ok: true, row: object, meta: object }
 *          | { ok: false, skip: string }      mensaje que no es un consumo (no es un error)
 *          | { ok: false, error: string }}    petición inválida
 */
export function buildIngestTransaction(rawInput, ctx = {}) {
  // El cuerpo viene de fuera: cualquier campo puede faltar o traer otro tipo.
  const input = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? rawInput : {};
  const { categories = [], cards = [], history = [], currency = 'DOP', todayISO } = ctx;
  const hasText = typeof input.text === 'string' && input.text.trim() !== '';
  const explicitAmount = parseAmount(input.amount);

  // El texto solo se interpreta si hace falta: con monto explícito (atajo de
  // Apple Pay) el texto es, como mucho, contexto extra para comercio/tarjeta.
  const parsed = hasText ? parseNotificationText(input.text) : null;
  // Un rechazo, reverso o pago a la tarjeta no es un gasto aunque el atajo
  // también haya mandado un monto.
  if (parsed?.kind === 'skip' && HARD_SKIPS.has(parsed.reason)) {
    return { ok: false, skip: parsed.reason };
  }
  if (!explicitAmount) {
    if (!parsed) return { ok: false, error: 'missing_amount' };
    if (parsed.kind === 'skip') {
      return parsed.reason === 'no_amount' || parsed.reason === 'empty'
        ? { ok: false, error: 'missing_amount' }
        : { ok: false, skip: parsed.reason };
    }
  }
  const fromText = parsed?.kind === 'purchase' ? parsed : null;

  const amount = explicitAmount ?? fromText.amount;
  const source = INGEST_SOURCES.includes(input.source)
    ? input.source
    : (explicitAmount ? 'shortcut' : 'email');

  // Id del mensaje en origen (p. ej. el id del correo en Gmail): permite que
  // reprocesar el mismo correo no duplique. Se acota y se limita a ASCII visible.
  const rawId = typeof input.id === 'string' || typeof input.id === 'number' ? String(input.id).trim() : '';
  const externalId = /^[\x21-\x7e]{1,128}$/.test(rawId) ? rawId : null;

  const merchant = (typeof input.merchant === 'string' ? cleanMerchant(input.merchant) : '') || fromText?.merchant || '';
  const description = merchant || FALLBACK_DESCRIPTION[source];

  // Tarjeta: primero la pista explícita (nombre de Wallet / últimos 4 del
  // correo). Solo si NO hubo pista alguna se recurre a "con qué pagas siempre
  // aquí" del historial; una pista que no casa significa débito u otra tarjeta.
  const last4 = /^\d{4}$/.test(String(input.last4 ?? '')) ? String(input.last4) : fromText?.last4 || null;
  const cardName = typeof input.card === 'string' ? input.card.trim() : '';
  const hasCardHint = Boolean(last4 || cardName);
  const memory = merchant ? suggestFromHistory(merchant, history) : null;

  let card = hasCardHint ? matchCard(cards, { name: cardName, last4 }) : null;
  if (!hasCardHint && memory?.cardId) card = cards.find((c) => c.id === memory.cardId) || null;

  // Categoría: lo que el usuario eligió antes para este comercio manda sobre
  // las palabras clave. Una categoría de ingreso/ahorro, o una desactivada, nunca
  // aplica a un consumo nuevo.
  const expenseCategories = categories.filter((c) => EXPENSE_TYPES.has(c.type) && c.isActive !== false);
  const category =
    expenseCategories.find((c) => c.id === memory?.categoryId) ||
    (merchant ? autoCategorize(merchant, expenseCategories) : null) ||
    null;

  // Moneda: FinTrack guarda todo en la moneda del perfil y no tiene tasas de
  // cambio. Un consumo en otra moneda se registra igual (perderlo es peor) pero
  // marcado para que el usuario corrija el monto.
  const detected = detectCurrency(input.amount) || fromText?.currency || null;
  const foreignCurrency = detected && detected !== currency ? detected : null;
  const notes = foreignCurrency
    ? `⚠ Monto original en ${foreignCurrency}, sin convertir a ${currency}. Revísalo.`
    : null;

  return {
    ok: true,
    row: {
      amount,
      date: resolveDate(parseDate(input.date) || fromText?.date, todayISO),
      type: category?.type || 'variable_expense',
      description,
      categoryId: category?.id || null,
      cardId: card?.id || null,
      currency,
      cashbackEarned: card ? computeCashback(card, category?.id || null, amount) : 0,
      notes,
      source,
      externalId,
    },
    meta: {
      categoryName: category?.name || null,
      cardName: card?.name || null,
      foreignCurrency,
    },
  };
}
