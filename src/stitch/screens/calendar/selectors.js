// Selectores puros del Calendario. Reciben datos ya cargados de los stores y
// devuelven mapas/listas por día. ISO local (sin toISOString).
import { getEffectiveAmount } from '../../../utils/calculations';
import { getCardBalances } from '../../../utils/creditCards';
import { getNextLoanDueDate } from '../../../utils/loanReminders';
import { tr } from '../../../i18n/runtime';

const EXPENSE_TYPES = ['expense', 'fixed_expense', 'variable_expense'];
const isExpense = (t) => EXPENSE_TYPES.includes(t.type);

const COLOR = { deuda: '#ffb4ab', tarjeta: '#ffb689', meta: '#bdd200', recurrente: '#50d8e9' };
const TO = { deuda: '/deudas', tarjeta: '/tarjetas', meta: '/ahorros', recurrente: '/transacciones' };

const parseISO = (iso) => new Date(iso + 'T00:00:00');
const inMonth = (iso, year, month) => {
  if (!iso) return false;
  const d = parseISO(String(iso).slice(0, 10));
  return d.getFullYear() === year && d.getMonth() === month;
};
const dayOf = (iso) => parseISO(String(iso).slice(0, 10)).getDate();

// Movimientos pasados por día del mes.
export function getDayMovements(transactions, year, month) {
  const map = {};
  for (const t of transactions) {
    if (!inMonth(t.date, year, month)) continue;
    const day = dayOf(t.date);
    if (!map[day]) map[day] = { income: 0, expense: 0, list: [] };
    map[day].list.push(t);
    if (t.type === 'income') map[day].income += Number(t.amount) || 0;
    else if (isExpense(t)) map[day].expense += getEffectiveAmount(t);
  }
  return map;
}

// Eventos de vencimiento por día del mes (4 fuentes).
export function getDueEvents({ debts = [], cards = [], goals = [], recurring = [], debtPayments = [] }, year, month, now, transactions = []) {
  const map = {};
  const push = (day, ev) => { (map[day] = map[day] || []).push(ev); };

  debts.forEach((d) => {
    if (d.status !== 'active' || !d.due_date) return;
    // Próxima fecha de pago pendiente (si ya se pagó este mes, rueda al siguiente).
    const nextDue = getNextLoanDueDate(d, debtPayments, now);
    if (!nextDue || !inMonth(nextDue, year, month)) return;
    push(dayOf(nextDue), { type: 'deuda', label: d.creditorName, amount: Number(d.monthlyPayment) || 0, color: COLOR.deuda, to: TO.deuda });
  });

  cards.forEach((c) => {
    const bal = getCardBalances(c, transactions, now);
    if (!bal || bal.isPaid || (bal.pendingBilled || 0) <= 0) return;
    const iso = bal.cycles?.dueDateISO;
    if (!inMonth(iso, year, month)) return;
    push(dayOf(iso), { type: 'tarjeta', label: c.name, amount: bal.pendingBilled, color: COLOR.tarjeta, to: TO.tarjeta });
  });

  goals.forEach((g) => {
    if (g.status === 'completed' || !g.deadline || !inMonth(g.deadline, year, month)) return;
    push(dayOf(g.deadline), { type: 'meta', label: g.title, amount: Number(g.targetAmount) || 0, color: COLOR.meta, to: TO.meta });
  });

  recurring.forEach((r) => {
    if (!r.active || !r.nextDate || !inMonth(r.nextDate, year, month)) return;
    push(dayOf(r.nextDate), { type: 'recurrente', label: r.description || tr('screens.calendar.recurring'), amount: Number(r.amount) || 0, color: COLOR.recurrente, to: TO.recurrente });
  });

  return map;
}

// Resumen del mes (ingreso/gasto/balance, neto de cashback).
export function getMonthSummary(transactions, year, month) {
  let income = 0, expense = 0;
  for (const t of transactions) {
    if (!inMonth(t.date, year, month)) continue;
    if (t.type === 'income') income += Number(t.amount) || 0;
    else if (isExpense(t)) expense += getEffectiveAmount(t);
  }
  return { income, expense, balance: income - expense };
}

// Próximos vencimientos: desde hoy hasta +days, ordenados por fecha.
export function getUpcoming({ debts = [], cards = [], goals = [], recurring = [], debtPayments = [] }, now, transactions = [], days = 30) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const limit = new Date(today); limit.setDate(limit.getDate() + days);
  const out = [];
  const add = (iso, type, label, amount) => {
    if (!iso) return;
    const d = parseISO(String(iso).slice(0, 10));
    if (d < today || d > limit) return;
    const daysUntil = Math.round((d - today) / 86400000);
    out.push({ date: String(iso).slice(0, 10), daysUntil, type, label, amount, color: COLOR[type], to: TO[type] });
  };

  debts.forEach((d) => { if (d.status === 'active') add(getNextLoanDueDate(d, debtPayments, now), 'deuda', d.creditorName, Number(d.monthlyPayment) || 0); });
  cards.forEach((c) => {
    const bal = getCardBalances(c, transactions, now);
    if (bal && !bal.isPaid && (bal.pendingBilled || 0) > 0) add(bal.cycles?.dueDateISO, 'tarjeta', c.name, bal.pendingBilled);
  });
  goals.forEach((g) => { if (g.status !== 'completed') add(g.deadline, 'meta', g.title, Number(g.targetAmount) || 0); });
  recurring.forEach((r) => { if (r.active) add(r.nextDate, 'recurrente', r.description || tr('screens.calendar.recurring'), Number(r.amount) || 0); });

  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
