// FinTrack — Tokens de ingesta (registro automático de gastos).
//
// Un Atajo de iOS no puede iniciar sesión con Supabase, así que se autentica
// con un token personal de larga vida. Modelo (igual que los PAT de GitHub):
//   - se genera en el NAVEGADOR con 256 bits de entropía y se muestra UNA vez;
//   - en la base solo se guarda su SHA-256 (tabla ingest_tokens), así que una
//     fuga de la tabla no permite registrar gastos a nombre de nadie;
//   - el endpoint /api/ingest recibe el token, lo hashea y busca el hash.
// Con 256 bits aleatorios un hash rápido es suficiente: no hay diccionario que
// atacar (a diferencia de una contraseña), por eso no hace falta bcrypt/argon.
//
// Web Crypto está en el navegador y en Node ≥ 20 (globalThis.crypto), así que
// este módulo lo comparten el front y la función serverless.

export const TOKEN_PREFIX = 'ft_';
const TOKEN_RE = /^ft_[A-Za-z0-9_-]{43}$/;

/** ¿Tiene forma de token de FinTrack? Corta entradas basura antes de ir a la BD. */
export function isTokenShape(value) {
  return typeof value === 'string' && TOKEN_RE.test(value);
}

/** Token nuevo: `ft_` + 32 bytes aleatorios en base64url (43 caracteres). */
export function generateToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64url = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return TOKEN_PREFIX + b64url;
}

/** SHA-256 del token en hexadecimal: lo único que se persiste. */
export async function hashToken(token) {
  const data = new TextEncoder().encode(String(token));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Pista visible en la lista de tokens (nunca el token completo). */
export function tokenHint(token) {
  return String(token).slice(-4);
}
