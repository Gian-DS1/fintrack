// FinTrack — Formatters

import { currentLocale, tr } from '../i18n/runtime.js';
import { getCurrency } from './currencyRuntime.js';

// Cachés módulo-level: Intl.NumberFormat es caro de construir (~25µs) y estas
// funciones corren por cada celda del Ledger y punto de chart en cada render.
const symbolCache = new Map();    // `${code}|${locale}` → símbolo
const amountFmtCache = new Map(); // locale → Intl.NumberFormat (2 decimales)

function amountFormatter(locale) {
  let fmt = amountFmtCache.get(locale);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    amountFmtCache.set(locale, fmt);
  }
  return fmt;
}

// Símbolo de una moneda en el locale actual (RD$, US$, €, £, MX$…).
// Estrategia: 'symbol' primero (da RD$, US$); si devuelve el mismo código ISO
// (p. ej. EUR→EUR en es-DO), intenta 'narrowSymbol' (EUR→€). Fallback: código.
// Nota: para códigos ISO reservados (XXX) Intl devuelve '¤'; para códigos
// malformados el constructor lanza y caemos al código vía catch.
function currencySymbol(code, locale) {
  const key = `${code}|${locale}`;
  const cached = symbolCache.get(key);
  if (cached !== undefined) return cached;
  let result;
  try {
    const fmt = (display) =>
      new Intl.NumberFormat(locale, {
        style: 'currency', currency: code, currencyDisplay: display,
      }).formatToParts(0).find((p) => p.type === 'currency')?.value;
    const sym = fmt('symbol');
    if (sym && sym !== code) {
      result = sym;
    } else {
      const narrow = fmt('narrowSymbol');
      result = narrow || code;
    }
  } catch {
    result = code;
  }
  symbolCache.set(key, result);
  return result;
}

// Blindaje de entrada: los formatters reciben datos de cálculos encadenados y
// de la DB; un NaN/undefined que se cuele no debe pintar "RD$ NaN" en la UI.
function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Format a number as currency. Sin `currencyCode` usa la moneda del usuario.
 */
export function formatCurrency(amount, currencyCode) {
  const n = safeNumber(amount);
  const code = currencyCode || getCurrency();
  const locale = currentLocale();
  const formatted = amountFormatter(locale).format(Math.abs(n));
  const sign = n < 0 ? '-' : '';
  // Espacio irrompible: "RD$ 1,094,025.00" no debe partirse entre símbolo y
  // cifra al envolver línea (en móvil el monto quedaba debajo del "RD$").
  return `${sign}${currencySymbol(code, locale)}\u00A0${formatted}`;
}

// Número compacto sin símbolo (1.5K, 2.3M, 4.1B). Base de los formatos de abajo.
function compactAmount(absAmount) {
  if (absAmount >= 1_000_000_000) return (absAmount / 1_000_000_000).toFixed(1) + 'B';
  if (absAmount >= 1_000_000) return (absAmount / 1_000_000).toFixed(1) + 'M';
  if (absAmount >= 1_000) return (absAmount / 1_000).toFixed(1) + 'K';
  return absAmount.toFixed(2);
}

/**
 * Format a number as compact currency (e.g., RD$ 1.5K)
 */
export function formatCurrencyCompact(amount, currencyCode) {
  const n = safeNumber(amount);
  const code = currencyCode || getCurrency();
  const locale = currentLocale();
  const sign = n < 0 ? '-' : '';
  return `${sign}${currencySymbol(code, locale)}\u00A0${compactAmount(Math.abs(n))}`;
}

/**
 * Compacto SIN símbolo de moneda (170.0K) — para ejes de charts y montos en
 * móvil donde la moneda ya es contexto. (Antes se hacía .replace('RD$', ''),
 * que rompía con cualquier otra moneda del perfil.)
 */
export function formatAmountCompact(amount) {
  const n = safeNumber(amount);
  const sign = n < 0 ? '-' : '';
  return `${sign}${compactAmount(Math.abs(n))}`;
}

/**
 * Format a date string to localized display
 */
export function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString(currentLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Format date as ISO (YYYY-MM-DD)
 */
export function toISODate(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  // Use local calendar components (not toISOString, which is UTC and would
  // roll over to the next day during the evening in negative-offset zones
  // like República Dominicana, GMT-4).
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get today's date as ISO string
 */
export function todayISO() {
  return toISODate(new Date());
}

/**
 * Generate a unique ID
 */
export function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/**
 * Pone en mayúscula la primera letra de cada palabra, dejando el resto tal cual
 * (no fuerza minúsculas, para no dañar siglas como "ATM" o "USD").
 * Ej: "supermercado nacional" → "Supermercado Nacional".
 */
export function titleCase(str) {
  if (!str) return '';
  return str.replace(/(^|\s)(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
}

/**
 * Get transaction type label in the active language
 */
export function getTypeLabel(type) {
  return tr(`types.${type}`, type);
}
