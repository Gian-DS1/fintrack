// «Ya lo comprobé» de la nota de pagos legados (`paidCycles`) de la celda «Dinero
// real»: vive SOLO en el dispositivo (localStorage), nunca en Supabase. Todo acceso
// va envuelto en try/catch (modo privado, almacenamiento bloqueado o lleno): sin
// almacenamiento la nota simplemente sigue visible.
//
// La clave va versionada y es POR USUARIO: en un dispositivo compartido nadie hereda
// el cierre de otro. Se borra al cerrar sesión (clearUserData → clearLegacyNotes).

const KEY_PREFIX = 'fintrack-legacy-paid-cycles-note';
export const legacyNoteKey = (userId) => `${KEY_PREFIX}:v1:${userId}`;

function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function isLegacyNoteDismissed(userId, storage = defaultStorage()) {
  try {
    return storage?.getItem(legacyNoteKey(userId)) === '1';
  } catch {
    return false;
  }
}

/** @returns {boolean} true si se guardó. */
export function dismissLegacyNote(userId, storage = defaultStorage()) {
  try {
    if (!storage) return false;
    storage.setItem(legacyNoteKey(userId), '1');
    return true;
  } catch {
    return false;
  }
}

/** Borra el cierre de todos los usuarios (fin de sesión). */
export function clearLegacyNotes(storage = defaultStorage()) {
  try {
    if (!storage) return;
    const keys = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(KEY_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Almacenamiento bloqueado: no hay nada que limpiar.
  }
}
