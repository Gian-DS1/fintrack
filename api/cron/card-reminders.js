// /api/cron/card-reminders — envía por correo los recordatorios de pago de
// tarjetas Y PRÉSTAMOS en un solo correo diario. Lo dispara Vercel Cron una
// vez al día (ver "crons" en vercel.json). El archivo conserva el nombre
// "card-reminders" (y la ruta registrada en Vercel) aunque ahora cubra ambos:
// renombrarlo no aporta nada funcional y arriesga una ventana de 404 entre
// deploy y re-registro del cron.
//
// Por qué un cron y no lógica en el navegador: el aviso debe llegar aunque el
// usuario NO abra la app; ese es justamente el caso que causa la mora.
//
// Las preferencias (reminders_enabled, reminder_days_before) son COMPARTIDAS
// entre tarjetas y préstamos: un solo interruptor, una sola antelación. Los
// préstamos no generan avisos de mora (ver src/utils/loanReminders.js), así
// que ese comportamiento solo aplica a tarjetas.
//
// Seguridad: este endpoint corre con la service_role key, que salta RLS y ve
// los datos de todos los usuarios. Por eso:
//   1. Exige `Authorization: Bearer <CRON_SECRET>` (Vercel Cron lo manda solo),
//      comparado en tiempo constante.
//   2. Si falta cualquier variable de entorno, responde 503 y NUNCA construye
//      el cliente admin (mismo criterio que api/feedback.js con su access key).
//   3. Solo acepta GET y no expone CORS.
//
// check_rate_limit NO aplica aquí: es security definer sobre auth.uid(), que es
// null con service_role. El límite real es el cron diario + la bitácora.

import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import {
  getDueReminders, todayInZone, reminderKey,
  DEFAULT_DAYS_BEFORE, REMINDER_TIMEZONE, OVERDUE_MAX_DAYS,
} from '../../src/utils/cardReminders.js';
import { getDueLoanReminders, loanReminderKey } from '../../src/utils/loanReminders.js';
import { buildReminderEmail } from '../_lib/reminderEmail.js';
import { mapCardRow, mapTransactionRow, mapDebtRow, mapDebtPaymentRow, groupByUser } from '../_lib/mapRows.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Comparación en tiempo constante (evita filtrar el secreto por timing). */
function secretMatches(provided, expected) {
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Todos los usuarios de auth.users → Map<id, email>. Pagina hasta agotar. */
async function fetchUserEmails(admin) {
  const emails = new Map();
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const users = data?.users || [];
    for (const u of users) if (u.email) emails.set(u.id, u.email);
    if (users.length < perPage) break;
  }
  return emails;
}

async function sendEmail({ apiKey, from, to, subject, html, text }) {
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json().catch(() => ({}));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
    VITE_SUPABASE_URL, REMINDER_FROM, APP_URL, REMINDER_TIMEZONE: TZ_ENV,
  } = process.env;

  // Fail-closed: sin configuración completa el endpoint se desactiva limpio.
  if (!CRON_SECRET || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY || !VITE_SUPABASE_URL) {
    console.warn('card-reminders: faltan variables de entorno; cron deshabilitado.');
    return res.status(503).json({ error: 'Recordatorios no configurados.' });
  }

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ') || !secretMatches(auth.slice(7), CRON_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const from = REMINDER_FROM || 'FinTrack <onboarding@resend.dev>';
  const appUrl = APP_URL || 'https://fintrack-rd.vercel.app';
  const timeZone = TZ_ENV || REMINDER_TIMEZONE;

  try {
    const admin = createClient(VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Perfiles con los recordatorios activos.
    const { data: profiles, error: profErr } = await admin
      .from('profiles')
      .select('user_id, currency, reminders_enabled, reminder_days_before')
      .eq('reminders_enabled', true);

    if (profErr) {
      // Columna inexistente = migración sin correr. No es un fallo del cron:
      // se registra y se sale en verde para no ensuciar el log de Vercel.
      console.warn('card-reminders: profiles no disponible (¿migración sin correr?):', profErr.message);
      return res.status(200).json({ ok: true, users: 0, emails: 0, reminders: 0, skipped: 'migration' });
    }
    if (!profiles?.length) {
      return res.status(200).json({ ok: true, users: 0, emails: 0, reminders: 0 });
    }

    const userIds = profiles.map((p) => p.user_id);
    const refDate = todayInZone(timeZone);

    // 2. Lecturas anchas (no N·N): tarjetas, transacciones y préstamos de
    //    todos. Los préstamos se filtran en el servidor (activos y con fecha
    //    de pago) porque no hace falta traer nada más: minimum_payment está
    //    almacenado, no se deriva de transacciones.
    const [cardsRes, txRes, debtsRes, debtPaymentsRes, emails] = await Promise.all([
      admin.from('credit_cards')
        .select('id, user_id, name, bank, cutoff_day, due_day, opening_balance, color, paid_cycles, payments, cashback_rules, catalog_id')
        .in('user_id', userIds),
      admin.from('transactions')
        .select('id, user_id, card_id, date, amount, cashback_earned')
        .in('user_id', userIds)
        .not('card_id', 'is', null),
      admin.from('debts')
        .select('id, user_id, creditor_name, total_amount, current_balance, interest_rate, minimum_payment, due_date, status, currency')
        .in('user_id', userIds)
        .eq('status', 'active')
        .not('due_date', 'is', null),
      admin.from('debt_payments')
        .select('id, user_id, debt_id, amount, date')
        .in('user_id', userIds),
      fetchUserEmails(admin),
    ]);
    if (cardsRes.error) throw new Error(`credit_cards: ${cardsRes.error.message}`);
    if (txRes.error) throw new Error(`transactions: ${txRes.error.message}`);

    const cardsByUser = groupByUser(cardsRes.data || [], mapCardRow);
    const txByUser = groupByUser(txRes.data || [], mapTransactionRow);

    // Los préstamos son la parte nueva de este cron: un fallo aquí no debe
    // tumbar los recordatorios de tarjetas que ya funcionan.
    let debtsByUser = new Map();
    if (debtsRes.error) {
      console.warn('card-reminders: debts no disponible:', debtsRes.error.message);
    } else {
      debtsByUser = groupByUser(debtsRes.data || [], mapDebtRow);
    }

    let paymentsByUser = new Map();
    if (debtPaymentsRes?.error) {
      console.warn('card-reminders: debt_payments no disponible:', debtPaymentsRes.error.message);
    } else {
      paymentsByUser = groupByUser(debtPaymentsRes?.data || [], mapDebtPaymentRow);
    }

    // 3. Bitácora reciente → claves ya enviadas. La ventana cubre desde la
    //    antelación máxima configurada hasta el tope de mora.
    const maxAhead = Math.max(...profiles.flatMap((p) => (
      Array.isArray(p.reminder_days_before) && p.reminder_days_before.length
        ? p.reminder_days_before
        : DEFAULT_DAYS_BEFORE
    )), 0);
    const windowStart = new Date(refDate); windowStart.setDate(windowStart.getDate() - OVERDUE_MAX_DAYS);
    const windowEnd = new Date(refDate); windowEnd.setDate(windowEnd.getDate() + maxAhead);
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const { data: logRows, error: logErr } = await admin
      .from('reminder_log')
      .select('user_id, card_id, due_date, offset_key')
      .in('user_id', userIds)
      .gte('due_date', iso(windowStart))
      .lte('due_date', iso(windowEnd));
    if (logErr) throw new Error(`reminder_log: ${logErr.message}`);

    const sentByUser = new Map();
    for (const row of logRows || []) {
      const set = sentByUser.get(row.user_id) || new Set();
      set.add(reminderKey(row.card_id, row.due_date, row.offset_key));
      sentByUser.set(row.user_id, set);
    }

    // Bitácora de préstamos, misma ventana. Si la tabla no existe (migración
    // sin correr) NO se cae el cron: se omiten los préstamos ese día. Enviarlos
    // sin bitácora sería peor —un correo repetido cada mañana— que no enviarlos.
    let loansEnabled = true;
    const loanSentByUser = new Map();
    const { data: loanLogRows, error: loanLogErr } = await admin
      .from('loan_reminder_log')
      .select('user_id, debt_id, due_date, offset_key')
      .in('user_id', userIds)
      .gte('due_date', iso(windowStart))
      .lte('due_date', iso(windowEnd));
    if (loanLogErr) {
      console.warn('card-reminders: loan_reminder_log no disponible (¿migración sin correr?):', loanLogErr.message);
      loansEnabled = false;
    } else {
      for (const row of loanLogRows || []) {
        const set = loanSentByUser.get(row.user_id) || new Set();
        set.add(loanReminderKey(row.debt_id, row.due_date, row.offset_key));
        loanSentByUser.set(row.user_id, set);
      }
    }

    // 4. Por usuario: calcular, enviar y registrar.
    let emailsSent = 0;
    let remindersSent = 0;
    let cardRemindersSent = 0;
    let loanRemindersSent = 0;
    const newLogRows = [];
    const newLoanLogRows = [];

    for (const profile of profiles) {
      const uid = profile.user_id;
      try {
        const to = emails.get(uid);
        if (!to) continue; // usuario sin correo verificable: nada que enviar

        const daysBefore = Array.isArray(profile.reminder_days_before) && profile.reminder_days_before.length
          ? profile.reminder_days_before
          : DEFAULT_DAYS_BEFORE;

        const reminders = getDueReminders(
          cardsByUser.get(uid) || [],
          txByUser.get(uid) || [],
          refDate,
          daysBefore,
          sentByUser.get(uid) || new Set(),
        );
        const loans = loansEnabled
          ? getDueLoanReminders(
              debtsByUser.get(uid) || [],
              paymentsByUser.get(uid) || [],
              refDate,
              daysBefore,
              loanSentByUser.get(uid) || new Set(),
            )
          : [];
        if (!reminders.length && !loans.length) continue;

        const mail = buildReminderEmail({
          reminders,
          loans,
          currency: profile.currency || 'DOP',
          appUrl,
        });

        await sendEmail({ apiKey: RESEND_API_KEY, from, to, ...mail });
        emailsSent += 1;
        remindersSent += reminders.length + loans.length;
        cardRemindersSent += reminders.length;
        loanRemindersSent += loans.length;

        // Solo se registra tras un envío exitoso: si el correo falla, el aviso
        // se reintenta mañana en vez de perderse para siempre.
        for (const r of reminders) {
          newLogRows.push({
            user_id: uid, card_id: r.cardId,
            due_date: r.dueDateISO, offset_key: r.offsetKey, channel: 'email',
          });
        }
        for (const l of loans) {
          newLoanLogRows.push({
            user_id: uid, debt_id: l.debtId,
            due_date: l.dueDateISO, offset_key: l.offsetKey, channel: 'email',
          });
        }
      } catch (err) {
        // Un usuario problemático no puede tumbar el lote completo.
        console.error(`card-reminders: fallo para el usuario ${uid}:`, err.message);
      }
    }

    if (newLogRows.length) {
      const { error: insErr } = await admin
        .from('reminder_log')
        .upsert(newLogRows, { onConflict: 'user_id,card_id,due_date,offset_key,channel', ignoreDuplicates: true });
      if (insErr) console.error('card-reminders: no se pudo escribir la bitácora:', insErr.message);
    }

    if (newLoanLogRows.length) {
      const { error: insErr } = await admin
        .from('loan_reminder_log')
        .upsert(newLoanLogRows, { onConflict: 'user_id,debt_id,due_date,offset_key,channel', ignoreDuplicates: true });
      if (insErr) console.error('card-reminders: no se pudo escribir la bitácora de préstamos:', insErr.message);
    }

    return res.status(200).json({
      ok: true,
      date: iso(refDate),
      users: profiles.length,
      emails: emailsSent,
      reminders: remindersSent,
      cards: cardRemindersSent,
      loans: loanRemindersSent,
    });
  } catch (error) {
    console.error('card-reminders error:', error);
    return res.status(500).json({ error: 'No se pudieron enviar los recordatorios.' });
  }
}
