// FinTrack — Generador centralizado de IDs únicos para registros locales y modo demo.

/**
 * Genera un UUID v4 seguro o un fallback pseudoaleatorio basado en tiempo.
 * @param {string} [prefix=''] Prefijo opcional (ej. 'demo-', 'p-') si el fallback lo requiere.
 * @returns {string}
 */
export function generateId(prefix = '') {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  const fallback = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  return prefix ? `${prefix}${fallback}` : fallback;
}
