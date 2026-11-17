// /api/ingest — registro automático de gastos.
//
// Recibe un consumo desde fuera de la app y lo guarda como transacción:
//   - Atajo de iOS con el disparador "Transacción" (Apple Pay): manda
//     { amount, merchant, card } apenas se toca el teléfono en el datáfono.
//   - Correos de notificación del banco: un atajo de iOS (disparador "Correo")
//     o un script de Gmail manda { text: "<cuerpo del correo>" } y aquí se
//     extraen monto, comercio, tarjeta y fecha.
// Guía de configuración y decisiones de diseño: docs/AUTO_INGEST.md.
//
// Seguridad:
//   1. Autenticación por token personal (`Authorization: Bearer ft_…`). El token
//      se genera en Ajustes, se muestra una vez y en la base solo vive su
//      SHA-256 (ver src/utils/ingestToken.js). Revocarlo es borrar su fila.
//   2. Corre con la service_role key porque quien llama no tiene sesión de
//      Supabase. Por eso TODA consulta va filtrada por el user_id que resolvió
//      el token, y sin la variable de entorno el endpoint responde 503 y nunca
//      construye el cliente admin (mismo criterio que api/cron/card-reminders).
//   3. El token solo puede CREAR gastos: este endpoint no lee ni devuelve datos
//      del usuario más allá del eco de lo que acaba de registrar.
//   4. Deduplicación y límite de 60 registros/hora dentro de la función SQL
//      ingest_transaction (atómica; ver supabase/add_auto_ingest.sql).
//   5. Los cuerpos de correo se procesan en memoria y NO se persisten ni se
//      loguean: solo se guarda el monto, el comercio y la fecha extraídos.

import { createClient } from '@supabase/supabase-js';
import { hashToken, isTokenShape } from '../src/utils/ingestToken.js';
import { buildIngestTransaction } from '../src/utils/ingestBuild.js';
import { todayInZone, REMINDER_TIMEZONE } from '../src/utils/cardReminders.js';

const MAX_TEXT_CHARS = 50_000;   // un correo HTML de banco ronda los 10-30k
const HISTORY_LIMIT = 500;       // transacciones recientes para la memoria

const SKIP_MESSAGES = {
  declined: 'Transacción rechazada: no se registró.',
  refund: 'Reverso o devolución: no se registró.',
  otp: 'Código de verificación: no se registró.',
  payment_or_income: 'Pago o ingreso: no se registró como gasto.',
  cash_withdrawal: 'Retiro de efectivo: no se registró como gasto.',
  not_a_purchase: 'El mensaje no parece un consumo: no se registró.',
};

const pad2 = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat('es-DO', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Cuerpo → objeto. Atajos manda JSON; se tolera JSON como string. */
function readBody(req) {
  const { body } = req;
  if (body && typeof body === 'object') return body;
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return null; }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL, REMINDER_TIMEZONE: TZ_ENV } = process.env;
  if (!SUPABASE_SERVICE_ROLE_KEY || !VITE_SUPABASE_URL) {
    console.warn('ingest: faltan variables de entorno; registro automático deshabilitado.');
    return res.status(503).json({ error: 'Registro automático no configurado.' });
  }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!isTokenShape(token)) {
    return res.status(401).json({ error: 'Token inválido o ausente.' });
  }

  const body = readBody(req);
  if (!body) {
    return res.status(400).json({ error: 'El cuerpo debe ser JSON.' });
  }
  if (typeof body.text === 'string' && body.text.length > MAX_TEXT_CHARS) {
    return res.status(413).json({ error: 'El texto es demasiado largo.' });
  }

  try {
    const admin = createClient(VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Token → usuario.
    const { data: tokenRow, error: tokenErr } = await admin
      .from('ingest_tokens')
      .select('id, user_id')
      .eq('token_hash', await hashToken(token))
      .maybeSingle();
    if (tokenErr) {
      console.warn('ingest: ingest_tokens no disponible (¿migración sin correr?):', tokenErr.message);
      return res.status(503).json({ error: 'Registro automático no configurado.' });
    }
    if (!tokenRow) {
      return res.status(401).json({ error: 'Token inválido o revocado.' });
    }
    const userId = tokenRow.user_id;

    // 2. Contexto del usuario para categorizar igual que el formulario manual.
    const [profileQ, categoriesQ, cardsQ, historyQ] = await Promise.all([
      admin.from('profiles').select('currency').eq('user_id', userId).maybeSingle(),
      admin.from('categories').select('id, name, type, keywords, is_active').eq('user_id', userId),
      admin.from('credit_cards').select('id, name, bank, last4, cashback_rules').eq('user_id', userId),
      admin.from('transactions').select('description, category_id, card_id, date')
        .eq('user_id', userId).order('date', { ascending: false }).limit(HISTORY_LIMIT),
    ]);
    const failed = [categoriesQ, cardsQ, historyQ].find((q) => q.error);
    if (failed) throw new Error(`lectura de contexto: ${failed.error.message}`);

    const currency = profileQ.data?.currency || 'DOP';
    const built = buildIngestTransaction(body, {
      currency,
      todayISO: toISO(todayInZone(TZ_ENV || REMINDER_TIMEZONE)),
      categories: (categoriesQ.data || []).map((c) => ({
        id: c.id, name: c.name, type: c.type, keywords: c.keywords || [], isActive: c.is_active !== false,
      })),
      cards: (cardsQ.data || []).map((c) => ({
        id: c.id, name: c.name, bank: c.bank || '', last4: c.last4 || null,
        cashbackRules: Array.isArray(c.cashback_rules) ? c.cashback_rules : [],
      })),
      history: (historyQ.data || []).map((t) => ({
        description: t.description, categoryId: t.category_id, cardId: t.card_id, date: t.date,
      })),
    });

    if (!built.ok && built.skip) {
      // 200 y no 4xx: para el atajo, un correo que no es un consumo no es un fallo.
      return res.status(200).json({
        ok: true, status: 'skipped', reason: built.skip,
        message: SKIP_MESSAGES[built.skip] || 'No se registró.',
      });
    }
    if (!built.ok) {
      return res.status(422).json({ error: 'No se encontró un monto válido en la petición.' });
    }

    // 3. Inserción atómica (dedupe + límite por hora).
    const { row, meta } = built;
    const { data: result, error: rpcErr } = await admin.rpc('ingest_transaction', {
      p_user_id: userId,
      p_amount: row.amount,
      p_date: row.date,
      p_type: row.type,
      p_description: row.description,
      p_category_id: row.categoryId,
      p_card_id: row.cardId,
      p_currency: row.currency,
      p_cashback: row.cashbackEarned,
      p_notes: row.notes,
      p_source: row.source,
      p_external_id: row.externalId,
    });
    if (rpcErr) throw new Error(`ingest_transaction: ${rpcErr.message}`);

    if (result?.status === 'rate_limited') {
      return res.status(429).json({ error: 'Demasiados registros automáticos en la última hora.' });
    }

    // Marca de uso del token: informativa, no debe tumbar un registro ya hecho.
    const { error: touchErr } = await admin
      .from('ingest_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', tokenRow.id);
    if (touchErr) console.warn('ingest: no se pudo marcar last_used_at:', touchErr.message);

    const summary = [formatMoney(row.amount, currency), row.description, meta.categoryName, meta.cardName]
      .filter(Boolean).join(' · ');
    const duplicate = result?.status === 'duplicate';
    const message = duplicate
      ? `Ya estaba registrado: ${summary}`
      : `Registrado: ${summary}${meta.foreignCurrency ? ` (monto en ${meta.foreignCurrency}, revísalo)` : ''}`;

    return res.status(duplicate ? 200 : 201).json({
      ok: true,
      status: duplicate ? 'duplicate' : 'created',
      id: result?.id || null,
      message,
      transaction: {
        amount: row.amount, date: row.date, description: row.description,
        category: meta.categoryName, card: meta.cardName, source: row.source,
      },
    });
  } catch (error) {
    // Detalle solo en el servidor (sin el cuerpo de la petición: puede traer el
    // correo del banco). Al cliente, un mensaje genérico.
    console.error('ingest:', error.message);
    return res.status(500).json({ error: 'No se pudo registrar el gasto. Intenta de nuevo.' });
  }
}
