// Tokens de ingesta (registro automático): acceso a la tabla `ingest_tokens`.
// RLS limita cada usuario a sus propias filas; aquí solo se listan, crean y
// revocan. El token en claro NUNCA sale del navegador hacia la base: se guarda
// su SHA-256 (ver src/utils/ingestToken.js) y se devuelve una sola vez a la UI.
import { supabase, getCurrentUser } from './supabase';
import { generateToken, hashToken, tokenHint } from '../utils/ingestToken';

export const MAX_INGEST_TOKENS = 5;

const mapFromDb = (row) => ({
  id: row.id,
  name: row.name,
  hint: row.token_hint,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
});

const COLUMNS = 'id, name, token_hint, created_at, last_used_at';

/** → Array de tokens (sin el secreto). Lanza si la consulta falla. */
export async function listIngestTokens() {
  const { data, error } = await supabase
    .from('ingest_tokens')
    .select(COLUMNS)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapFromDb);
}

/** Crea un token → { token: 'ft_…' (mostrar UNA vez), row }. */
export async function createIngestToken(name) {
  const user = await getCurrentUser();
  if (!user) throw new Error('No session');

  const token = generateToken();
  const { data, error } = await supabase
    .from('ingest_tokens')
    .insert({
      user_id: user.id,
      name: String(name || '').trim().slice(0, 40) || 'iPhone',
      token_hash: await hashToken(token),
      token_hint: tokenHint(token),
    })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return { token, row: mapFromDb(data) };
}

/** Revoca (borra) un token: el atajo que lo use recibe 401 desde ya. */
export async function revokeIngestToken(id) {
  const { error } = await supabase.from('ingest_tokens').delete().eq('id', id);
  if (error) throw error;
}
