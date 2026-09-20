// Modo QA / Demo — SOLO para localhost. Permite revisar las 11 pantallas con
// datos de ejemplo SIN tocar Supabase ni producción. No persiste nada en el
// backend; siembra los stores Zustand en memoria.
//
// Activación: botón "Entrar como demo" en StitchAuth (visible solo en localhost).
// Salida: cerrar sesión limpia el flag y recarga.

import useCategoryStore from '../stores/useCategoryStore';
import useTransactionStore from '../stores/useTransactionStore';
import useBudgetStore from '../stores/useBudgetStore';
import useBudgetGroupStore from '../stores/useBudgetGroupStore';
import useSavingsStore from '../stores/useSavingsStore';
import useDebtStore from '../stores/useDebtStore';
import useCreditCardStore from '../stores/useCreditCardStore';
import usePrefsStore from '../stores/usePrefsStore';
import { defaultCategories } from '../data/defaultCategories';
import { computeCashback } from '../utils/creditCards';
import { setRuntimeCurrency } from '../utils/currencyRuntime';

const DEMO_FLAG = 'fintrack-demo-mode';
const FRESH_FLAG = 'fintrack-fresh-mode';

// El modo demo (QA) solo se habilita en localhost. NUNCA en producción: expone
// la app con datos sembrados sin autenticación, así que debe quedar fuera del
// despliegue público.
export function isLocalhost() {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

export function isDemoActive() {
  return isLocalhost() && (
    sessionStorage.getItem(DEMO_FLAG) === '1' ||
    sessionStorage.getItem(FRESH_FLAG) === '1'
  );
}

// Distingue el sub-modo "usuario nuevo" (cuenta vacía) del demo establecido.
// Solo lo usan el seeding y el gate de onboarding; el resto del código trata
// ambos modos igual vía isDemoActive().
export function isFreshActive() {
  return isLocalhost() && sessionStorage.getItem(FRESH_FLAG) === '1';
}

export function exitDemo() {
  sessionStorage.removeItem(DEMO_FLAG);
  sessionStorage.removeItem(FRESH_FLAG);
}

// ── Datos de ejemplo (en memoria) ───────────────────────────────────────────
const today = new Date();
const iso = (d) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const dayOf = (n) => iso(new Date(today.getFullYear(), today.getMonth(), n));
const monthIdx = today.getMonth();
const yearIdx = today.getFullYear();

// Demo usa las 37 categorías REALES (con sus ~405 keywords) para que el
// autocompletado tenga material de verdad. Mapean al formato del store.
const categories = defaultCategories.map((c, i) => ({
  id: c.id,
  name: c.name,
  type: c.type,
  icon: c.icon,
  color: c.color,
  slug: c.slug || null,
  keywords: c.keywords || [],
  isActive: c.isActive !== false,
  sortOrder: i,
  isAccumulative: c.isAccumulative || false,
  accumulationStart: c.accumulationStart || null,
}));

// Resuelve el id real de una categoría por nombre (las default generan ids).
const catId = (name) => categories.find((c) => c.name === name)?.id || '';

// Helper para crear transacciones con fecha específica (año-mes-día)
const txWithDate = (id, catName, amount, type, description, dateStr, cashback = 0, cardId = null) => ({
  id, categoryId: catId(catName), cardId, amount, type, description, date: dateStr,
  notes: null, currency: 'DOP', cashbackEarned: cashback, createdAt: new Date().toISOString(),
});

// Genera transacciones sintéticas para un mes específico (year, month: 0-11)
// Cada mes tiene variaciones realistas en gastos variables, compras, etc.
function generateMonthlyTransactions(year, month, baseId) {
  const monthStr = String(month + 1).padStart(2, '0');
  const txList = [];
  let idCounter = baseId;

  const iso = (day) => `${year}-${monthStr}-${String(day).padStart(2, '0')}`;

  // Variación pseudoaleatoria por mes (seed basado en mes para reproducibilidad).
  // OJO: contador propio, separado de idCounter. Cuando random() compartía
  // idCounter, cada llamada "quemaba" un id sin emitir fila; el caller avanza
  // baseId por el número de FILAS, así que los rangos de meses se solapaban y
  // salían ids t### duplicados (keys duplicadas de React en el ledger demo).
  const seed = month * 7 + 13;
  let rngCounter = 1;
  const random = () => {
    const x = Math.sin(seed * rngCounter++) * 10000;
    return x - Math.floor(x);
  };

  // Ingresos (2 salarios quincenales: día 1 y 15)
  txList.push(txWithDate(`t${idCounter++}`, 'Salario', 85000, 'income', 'Salario quincenal', iso(1)));
  txList.push(txWithDate(`t${idCounter++}`, 'Salario', 85000, 'income', 'Salario quincenal', iso(15)));

  // Gastos fijos (consistentes pero con pequeñas variaciones)
  txList.push(txWithDate(`t${idCounter++}`, 'Alquiler', 32000, 'fixed_expense', 'Alquiler mensual', iso(2)));
  txList.push(txWithDate(`t${idCounter++}`, 'Internet', 1200, 'fixed_expense', 'Internet residencial', iso(5)));
  const utilities = Math.round(3500 + (random() - 0.5) * 800); // Varía 3100-3900 por clima/consumo
  txList.push(txWithDate(`t${idCounter++}`, 'Servicios Públicos', utilities, 'fixed_expense', 'Agua, luz y gas', iso(10)));

  // Gastos variables - Supermercado (2-4 visitas, montos variados)
  const grocery1 = Math.round(4800 + (random() - 0.5) * 1200); // 4200-5400
  const grocery2 = Math.round(3200 + (random() - 0.5) * 800); // 2800-3600
  const grocery3 = Math.round(2900 + (random() - 0.5) * 800); // 2500-3300
  txList.push(txWithDate(`t${idCounter++}`, 'Supermercado', grocery1, 'variable_expense', 'Supermercado Nacional', iso(4), Math.round(grocery1 * 0.01), 'cc1'));
  txList.push(txWithDate(`t${idCounter++}`, 'Supermercado', grocery2, 'variable_expense', 'Jumbo', iso(11), Math.round(grocery2 * 0.01), 'cc1'));
  txList.push(txWithDate(`t${idCounter++}`, 'Supermercado', grocery3, 'variable_expense', 'Carrefour', iso(20), Math.round(grocery3 * 0.01), 'cc1'));

  // Combustible (1-2 cargas, precio variable)
  const fuel1 = Math.round(1800 + (random() - 0.5) * 400); // 1600-2000
  const fuel2 = Math.round(1800 + (random() - 0.5) * 400);
  txList.push(txWithDate(`t${idCounter++}`, 'Combustible', fuel1, 'variable_expense', 'Gasolina', iso(6), Math.round(fuel1 * 0.01), 'cc1'));
  if (random() > 0.3) { // 70% de probabilidad de segunda carga
    txList.push(txWithDate(`t${idCounter++}`, 'Combustible', fuel2, 'variable_expense', 'Gasolina', iso(18), Math.round(fuel2 * 0.01), 'cc1'));
  }

  // Taxi y transporte (varía mucho cada mes)
  if (random() > 0.2) txList.push(txWithDate(`t${idCounter++}`, 'Taxi y Transporte', Math.round(450 + random() * 300), 'variable_expense', 'Uber', iso(3), 0, 'cc1'));
  if (random() > 0.3) txList.push(txWithDate(`t${idCounter++}`, 'Taxi y Transporte', Math.round(350 + random() * 200), 'variable_expense', 'Uber', iso(9), 0, 'cc1'));
  if (random() > 0.25) txList.push(txWithDate(`t${idCounter++}`, 'Taxi y Transporte', Math.round(520 + random() * 300), 'variable_expense', 'Uber', iso(21), 0, 'cc1'));

  // Restaurantes y delivery (varía mucho - viajes, invitaciones, etc.)
  const dining1 = Math.round(1200 + (random() - 0.5) * 500); // 950-1450
  const dining2 = Math.round(1450 + (random() - 0.5) * 600); // 1150-1750
  const dining3 = Math.round(890 + (random() - 0.5) * 400); // 690-1090
  txList.push(txWithDate(`t${idCounter++}`, 'Restaurantes y Delivery', dining1, 'variable_expense', 'Almuerzo', iso(7), Math.round(dining1 * 0.01), 'cc1'));
  if (random() > 0.25) txList.push(txWithDate(`t${idCounter++}`, 'Restaurantes y Delivery', dining2, 'variable_expense', 'Cena con amigos', iso(14), Math.round(dining2 * 0.01), 'cc1'));
  if (random() > 0.3) txList.push(txWithDate(`t${idCounter++}`, 'Restaurantes y Delivery', dining3, 'variable_expense', 'Comida rápida', iso(25), Math.round(dining3 * 0.01), 'cc1'));

  // Suscripciones digitales (fijas mensuales pero algunas meses hay nuevas)
  txList.push(txWithDate(`t${idCounter++}`, 'Suscripciones Digitales', 599, 'variable_expense', 'Netflix', iso(5)));
  txList.push(txWithDate(`t${idCounter++}`, 'Suscripciones Digitales', 299, 'variable_expense', 'Spotify', iso(6)));
  if (month === 2) txList.push(txWithDate(`t${idCounter++}`, 'Suscripciones Digitales', 299, 'variable_expense', 'Disney+', iso(3))); // Marzo: nueva suscripción
  if (month === 5 && random() > 0.4) txList.push(txWithDate(`t${idCounter++}`, 'Suscripciones Digitales', 199, 'variable_expense', 'YouTube Premium', iso(8))); // Junio: posible compra

  // Compras personales (MUCHA variación - algunos meses mucho, otros poco)
  if (month === 0 || month === 2 || month === 5) { // Enero, Marzo, Junio - más gastos
    const shopping1 = Math.round(3000 + random() * 2000); // 3000-5000
    txList.push(txWithDate(`t${idCounter++}`, 'Ropa y Accesorios', shopping1, 'variable_expense', 'Centro Comercial', iso(8 + Math.floor(random() * 10)), Math.round(shopping1 * 0.01), 'cc1'));
  } else if (random() > 0.5) {
    const shopping2 = Math.round(1500 + random() * 1500); // 1500-3000
    txList.push(txWithDate(`t${idCounter++}`, 'Ropa y Accesorios', shopping2, 'variable_expense', 'Tienda online', iso(12 + Math.floor(random() * 10)), Math.round(shopping2 * 0.01), 'cc1'));
  }

  // Higiene y salud (pequeñas variaciones)
  if (random() > 0.3) {
    const health = Math.round(450 + (random() - 0.5) * 200); // 350-550
    txList.push(txWithDate(`t${idCounter++}`, 'Higiene y Salud', health, 'variable_expense', 'Farmacia', iso(12 + Math.floor(random() * 10)), Math.round(health * 0.01), 'cc1'));
  }

  // Ocio/entretenimiento (varía según mes)
  if (month === 5) { // Junio: verano, más diversión
    txList.push(txWithDate(`t${idCounter++}`, 'Entretenimiento', 1200, 'variable_expense', 'Concierto/evento', iso(15 + Math.floor(random() * 10)), 12, 'cc1'));
  } else if (random() > 0.4) {
    const entertainment = Math.round(800 + (random() - 0.5) * 400); // 600-1000
    txList.push(txWithDate(`t${idCounter++}`, 'Entretenimiento', entertainment, 'variable_expense', 'Cine/actividad', iso(16 + Math.floor(random() * 8)), Math.round(entertainment * 0.01), 'cc1'));
  }

  // Gastos ocasionales según mes
  if (month === 1) { // Febrero: San Valentín
    txList.push(txWithDate(`t${idCounter++}`, 'Regalos', Math.round(1500 + random() * 1000), 'variable_expense', 'Regalo especial', iso(14), 0));
  }
  if (month === 3) { // Abril: Semana Santa - viaje
    txList.push(txWithDate(`t${idCounter++}`, 'Viajes y Turismo', Math.round(8000 + random() * 3000), 'variable_expense', 'Hospedaje vacaciones', iso(8 + Math.floor(random() * 10)), 0));
    txList.push(txWithDate(`t${idCounter++}`, 'Restaurantes y Delivery', Math.round(2500 + random() * 1500), 'variable_expense', 'Comidas en viaje', iso(10 + Math.floor(random() * 8)), 0));
  }
  if (month === 4) { // Mayo: fin de mes con bonificación
    // Última fila del mes: sin ++ (no-useless-assignment); si añades filas
    // después, vuelve a incrementar idCounter en cada una.
    txList.push(txWithDate(`t${idCounter}`, 'Salario', 12000, 'income', 'Bonificación performance', iso(28)));
  }

  return txList;
}

// Generar los últimos 6 meses TERMINANDO en el mes actual.
//
// Antes estaban clavados a enero-junio de 2026: pasado junio, el demo abria en
// un mes sin movimientos (resumen en cero, donut vacio, presupuesto al 0 %) y
// parecia roto. Al anclarlos a hoy, el demo se mantiene vivo con el paso del
// tiempo sin tocar el codigo.
const allTransactions = [];
let txId = 1;
for (let back = 5; back >= 0; back--) {
  const d = new Date(yearIdx, monthIdx - back, 1);
  const monthTxs = generateMonthlyTransactions(d.getFullYear(), d.getMonth(), txId);
  allTransactions.push(...monthTxs);
  txId += monthTxs.length;
}
// El generador reparte movimientos por todo el mes; en el mes en curso eso deja
// gastos con fecha futura. Los recortamos para que el mes actual se vea "a la
// mitad", como el de un usuario real.
const todayIso = iso(today);

const transactions = allTransactions.filter((t) => t.date <= todayIso);

const budgets = [
  { id: 'b1', categoryId: catId('Alquiler'), year: yearIdx, month: monthIdx, estimatedAmount: 32000, currency: 'DOP', createdAt: '' },
  { id: 'b2', categoryId: catId('Supermercado'), year: yearIdx, month: monthIdx, estimatedAmount: 12000, currency: 'DOP', createdAt: '' },
  { id: 'b3', categoryId: catId('Taxi y Transporte'), year: yearIdx, month: monthIdx, estimatedAmount: 5000, currency: 'DOP', createdAt: '' },
  { id: 'b4', categoryId: catId('Restaurantes y Delivery'), year: yearIdx, month: monthIdx, estimatedAmount: 6000, currency: 'DOP', createdAt: '' },
  { id: 'b5', categoryId: catId('Suscripciones Digitales'), year: yearIdx, month: monthIdx, estimatedAmount: 2000, currency: 'DOP', createdAt: '' },
  { id: 'b6', categoryId: catId('Salario'), year: yearIdx, month: monthIdx, estimatedAmount: 170000, currency: 'DOP', createdAt: '' },
];

// Grupo de presupuesto de ejemplo: dos categorías vistas como un total.
const budgetGroups = [
  { id: 'bg1', name: 'Comida', icon: null, categoryIds: [catId('Supermercado'), catId('Restaurantes y Delivery')], createdAt: '' },
];

const goals = [
  { id: 'g1', title: 'Fondo de emergencia', targetAmount: 180000, currentAmount: 105000, monthlyContribution: 15000, deadline: iso(new Date(yearIdx + 1, 2, 1)), icon: '🆘', color: '#bec2ff', status: 'active', currency: 'DOP', horizon: null, createdAt: '' },
  { id: 'g2', title: 'Viaje a Europa', targetAmount: 250000, currentAmount: 60000, monthlyContribution: 20000, deadline: iso(new Date(yearIdx + 1, 7, 1)), icon: '✈️', color: '#50d8e9', status: 'active', currency: 'DOP', horizon: 'medium', createdAt: '' },
  { id: 'g3', title: 'Laptop nueva', targetAmount: 90000, currentAmount: 90000, monthlyContribution: 0, deadline: null, icon: '💻', color: '#bdd200', status: 'completed', currency: 'DOP', horizon: 'short', createdAt: '' },
  { id: 'g4', title: 'Comprar apartamento', targetAmount: 2000000, currentAmount: 350000, monthlyContribution: 25000, deadline: iso(new Date(yearIdx + 4, 0, 1)), icon: '🏠', color: '#bec2ff', status: 'active', currency: 'DOP', horizon: 'long', createdAt: '' },
];

const debts = [
  { id: 'd1', creditorName: 'Préstamo vehículo', originalAmount: 600000, currentBalance: 360000, interestRate: 12.5, monthlyPayment: 14500, due_date: dayOf(28), status: 'active', currency: 'DOP', createdAt: '' },
  { id: 'd2', creditorName: 'Tarjeta departamental', originalAmount: 45000, currentBalance: 18000, interestRate: 6.0, monthlyPayment: 3000, due_date: dayOf(25), status: 'active', currency: 'DOP', createdAt: '' },
];

const cards = [
  { id: 'cc1', name: 'Visa Popular', bank: 'Banco Popular', cutoffDay: 20, dueDay: 5, color: '#bec2ff', paidCycles: [], payments: [], cashbackRules: [{ categoryId: 'all', percentage: 1 }], catalogId: null, createdAt: '' },
];

// Siembra todos los stores con los datos demo y marca loading=false.
export function seedDemoStores() {
  useCategoryStore.setState({ categories, loading: false });
  useTransactionStore.setState({ transactions, loading: false });
  useBudgetStore.setState({ budgets, loading: false });
  useBudgetGroupStore.setState({ groups: budgetGroups, loading: false });
  useSavingsStore.setState({ goals, contributions: [], loading: false });
  useDebtStore.setState({ debts, payments: [], loading: false });
  useCreditCardStore.setState({ cards, loading: false });
  usePrefsStore.setState({ currency: 'DOP', initialCashBalance: 75000 });
  setRuntimeCurrency('DOP');
}

// Activa el modo demo: marca el flag y siembra los datos.
export function enterDemo() {
  if (!isLocalhost()) return false;
  sessionStorage.setItem(DEMO_FLAG, '1');
  seedDemoStores();
  return true;
}

// Siembra TODOS los stores vacíos y resetea las prefs, simulando una cuenta
// recién creada. currency=null dispara el onboarding; tutorialSeen=false hace
// que el tour arranque solo tras elegir moneda. prefsLoaded=false porque el
// effect de StitchApp llama fetchPrefs() que lo marca true.
export function seedFreshStores() {
  useCategoryStore.setState({ categories: [], loading: false });
  useTransactionStore.setState({ transactions: [], loading: false });
  useBudgetStore.setState({ budgets: [], loading: false });
  useBudgetGroupStore.setState({ groups: [], loading: false });
  useSavingsStore.setState({ goals: [], contributions: [], loading: false });
  useDebtStore.setState({ debts: [], payments: [], loading: false });
  useCreditCardStore.setState({ cards: [], loading: false });
  usePrefsStore.setState({ currency: null, tutorialSeen: false, budgetLevel: 'tracking', prefsLoaded: false, initialCashBalance: 0 });
  setRuntimeCurrency(null);
}

// Activa el modo "usuario nuevo": marca el flag y siembra los stores vacíos.
export function enterFresh() {
  if (!isLocalhost()) return false;
  sessionStorage.setItem(FRESH_FLAG, '1');
  seedFreshStores();
  return true;
}

// ── Mutadores en memoria para el modo demo ──────────────────────────────────
// En demo NO hay sesión Supabase, así que las acciones de los stores (que
// escriben al backend) salen sin hacer nada. Estas funciones aplican la mutación
// SOLO al estado local, para que crear/editar/borrar funcione en QA. No persiste.
const demoId = () =>
  (globalThis.crypto?.randomUUID?.() || `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`);

// Transacciones
export function demoAddTransaction(tx) {
  const row = {
    id: demoId(), categoryId: tx.categoryId || '', cardId: tx.cardId || null,
    amount: Number(tx.amount), type: tx.type, description: tx.description || '',
    date: tx.date, notes: tx.notes || null, currency: tx.currency || 'DOP',
    cashbackEarned: Number(tx.cashbackEarned) || 0, createdAt: new Date().toISOString(),
  };
  useTransactionStore.setState((s) => ({ transactions: [row, ...s.transactions] }));
  return row.id;
}
export function demoUpdateTransaction(id, updates) {
  useTransactionStore.setState((s) => ({
    transactions: s.transactions.map((t) => (t.id === id ? { ...t, ...updates, amount: Number(updates.amount ?? t.amount) } : t)),
  }));
}
export function demoDeleteTransaction(id) {
  useTransactionStore.setState((s) => ({ transactions: s.transactions.filter((t) => t.id !== id) }));
}
export function demoRestoreTransaction(tx) {
  useTransactionStore.setState((s) => ({ transactions: [{ ...tx, id: demoId() }, ...s.transactions] }));
}

// ── Acciones en bloque (demo) ────────────────────────────────────────────────
// Replican bulkDeleteTransactions / restoreManyTransactions / bulkAssignCategory
// / bulkAssignCard del store, mutando solo el estado local. Devuelven lo mismo
// que el store real (filas borradas, etc.) para que el toast de "Deshacer"
// funcione igual en demo.
export function demoBulkDeleteTransactions(ids) {
  if (!ids || ids.length === 0) return [];
  const removed = useTransactionStore.getState().transactions.filter((t) => ids.includes(t.id));
  useTransactionStore.setState((s) => ({ transactions: s.transactions.filter((t) => !ids.includes(t.id)) }));
  return removed;
}
export function demoRestoreManyTransactions(txs) {
  if (!txs || txs.length === 0) return false;
  // Re-inserta con nuevos ids (igual que el store: nada referencia tx por id).
  const rows = txs.map((tx) => ({ ...tx, id: demoId() }));
  useTransactionStore.setState((s) => ({ transactions: [...rows, ...s.transactions] }));
  return true;
}
// El cashback aplica a CUALQUIER tipo de gasto (fijo o variable), no solo al
// tipo genérico 'expense'. Misma regla que el formulario de transacciones.
const earnsCashback = (type) => type === 'expense' || type === 'fixed_expense' || type === 'variable_expense';

export function demoBulkAssignCategory(ids, categoryId) {
  if (!ids || ids.length === 0) return;
  const cid = categoryId || null;
  const cards = useCreditCardStore.getState().cards;
  useTransactionStore.setState((s) => ({
    transactions: s.transactions.map((t) => {
      if (!ids.includes(t.id)) return t;
      const card = t.cardId ? cards.find((c) => c.id === t.cardId) : null;
      const cashback = (card && earnsCashback(t.type)) ? computeCashback(card, cid, t.amount) : 0;
      return { ...t, categoryId: cid, cashbackEarned: cashback };
    }),
  }));
}
export function demoBulkAssignCard(ids, cardId) {
  if (!ids || ids.length === 0) return;
  const cid = cardId || null;
  const cards = useCreditCardStore.getState().cards;
  const card = cid ? cards.find((c) => c.id === cid) : null;
  useTransactionStore.setState((s) => ({
    transactions: s.transactions.map((t) => {
      if (!ids.includes(t.id)) return t;
      const cashback = (card && earnsCashback(t.type)) ? computeCashback(card, t.categoryId, t.amount) : 0;
      return { ...t, cardId: cid, cashbackEarned: cashback };
    }),
  }));
}

// Presupuesto (sobres). En demo, setBudget real haría rollback + toast rojo (no
// hay sesión), así que se muta el estado local directamente. Mismo formato que
// useBudgetStore: fila por (categoryId, year, month).
export function demoSetBudget(categoryId, year, month, amount) {
  const value = Number(amount) || 0;
  useBudgetStore.setState((s) => {
    const i = s.budgets.findIndex((b) => b.categoryId === categoryId && b.year === year && b.month === month);
    if (i >= 0) {
      const next = [...s.budgets];
      next[i] = { ...next[i], estimatedAmount: value };
      return { budgets: next };
    }
    const row = { id: demoId(), categoryId, year, month, estimatedAmount: value, currency: 'DOP', createdAt: new Date().toISOString() };
    return { budgets: [...s.budgets, row] };
  });
}

// Copia los sobres del mes anterior a (year, month), PISANDO los montos de las
// filas existentes (al tocar un sobre se crea una fila con 0 que antes impedía
// copiar). "Copiar" debe dejar el mes igual al anterior; las categorías del mes
// destino sin sobre en el anterior se conservan tal cual.
// Devuelve true/false como el store (para que el toast del componente funcione).
export function demoCopyBudgetFromPreviousMonth(year, month) {
  let pm = month - 1, py = year;
  if (pm < 0) { pm = 11; py -= 1; }
  const prev = useBudgetStore.getState().budgets.filter((b) => b.year === py && b.month === pm);
  if (prev.length === 0) return false;
  const amounts = new Map(prev.map((pb) => [pb.categoryId, pb.estimatedAmount]));
  useBudgetStore.setState((s) => {
    const next = s.budgets.map((b) =>
      b.year === year && b.month === month && amounts.has(b.categoryId)
        ? { ...b, estimatedAmount: amounts.get(b.categoryId) }
        : b
    );
    const have = new Set(
      next.filter((b) => b.year === year && b.month === month).map((b) => b.categoryId)
    );
    const rows = prev
      .filter((pb) => !have.has(pb.categoryId))
      .map((pb) => ({
        id: demoId(), categoryId: pb.categoryId, year, month,
        estimatedAmount: pb.estimatedAmount, currency: 'DOP', createdAt: new Date().toISOString(),
      }));
    return { budgets: [...next, ...rows] };
  });
  return true;
}

// ── Tarjetas de crédito (en demo no hay sesión: las acciones del store fallan) ──
export function demoAddCard(card) {
  const row = {
    id: demoId(), name: card.name, bank: card.bank || '',
    cutoffDay: Number(card.cutoffDay), dueDay: Number(card.dueDay),
    color: card.color || '#bec2ff', openingBalance: Number(card.openingBalance) || 0,
    paidCycles: [], payments: [],
    cashbackRules: Array.isArray(card.cashbackRules) ? card.cashbackRules : [],
    catalogId: card.catalogId || null, createdAt: new Date().toISOString(),
  };
  useCreditCardStore.setState((s) => ({ cards: [...s.cards, row] }));
  return row;
}
export function demoUpdateCard(id, updates) {
  useCreditCardStore.setState((s) => ({ cards: s.cards.map((c) => (c.id === id ? { ...c, ...updates } : c)) }));
}
export function demoDeleteCard(id) {
  useCreditCardStore.setState((s) => ({ cards: s.cards.filter((c) => c.id !== id) }));
}
// Re-inserta una tarjeta borrada con su id original (deshacer).
export function demoRestoreCard(card) {
  useCreditCardStore.setState((s) => ({ cards: [...s.cards, card] }));
}
export function demoAddCardPayment(cardId, { amount, date, note, savingsUsed = [] } = {}) {
  const value = Number(amount) || 0;
  if (value <= 0) return null;
  const entry = { id: demoId(), amount: value, date: date || iso(new Date()), note: note || '', savingsUsed };
  useCreditCardStore.setState((s) => ({
    cards: s.cards.map((c) => (c.id === cardId ? { ...c, payments: [...(c.payments || []), entry] } : c)),
  }));
  return entry;
}

// Aplica un pago de tarjeta con cascada (ver applyDebtPaymentWithCascade).
export function applyCardPaymentWithCascade(cardId, { amount, date, note }, savingsPick) {
  const savingsUsed = [];
  if (savingsPick && savingsPick.amount > 0) {
    demoAddContribution(savingsPick.goalId, -Math.abs(savingsPick.amount), date, 'Retiro para pago de tarjeta');
    savingsUsed.push({ goalId: savingsPick.goalId, amount: Math.abs(savingsPick.amount) });
  }
  return demoAddCardPayment(cardId, { amount, date, note, savingsUsed });
}

export function demoDeleteCardPayment(cardId, paymentId) {
  // Reversa de cascada: devuelve a la meta lo que este pago tomó del ahorro.
  const card = useCreditCardStore.getState().cards.find((c) => c.id === cardId);
  const entry = card?.payments?.find((p) => p.id === paymentId);
  for (const s of (entry?.savingsUsed || [])) {
    demoAddContribution(s.goalId, Math.abs(s.amount), entry.date, 'Reversa de retiro por pago');
  }
  useCreditCardStore.setState((s) => ({
    cards: s.cards.map((c) => (c.id === cardId ? { ...c, payments: (c.payments || []).filter((p) => p.id !== paymentId) } : c)),
  }));
}

// ── Deudas y pagos (en demo el store sale sin efecto sin sesión) ──────────────
// Resuelve la categoría de pago de deuda para enlazar la transacción del pago.
function demoLoanCategoryId() {
  const cats = useCategoryStore.getState().categories;
  const c =
    cats.find((x) => x.slug === 'pago-deuda') ||
    cats.find((x) => x.name === 'Pago de Préstamos y Deudas' || (x.name && x.name.includes('Préstamos')));
  return c?.id || '';
}

export function demoAddDebt(debt) {
  const currentBalance = Number(debt.currentBalance !== undefined ? debt.currentBalance : debt.originalAmount);
  const row = {
    id: demoId(), creditorName: debt.creditorName,
    originalAmount: Number(debt.originalAmount), currentBalance,
    interestRate: Number(debt.interestRate) || 0, monthlyPayment: Number(debt.monthlyPayment) || 0,
    due_date: debt.dueDate || null, status: currentBalance <= 0 ? 'paid_off' : 'active',
    currency: debt.currency || 'DOP', createdAt: new Date().toISOString(),
  };
  useDebtStore.setState((s) => ({ debts: [...s.debts, row] }));
  return row;
}
export function demoUpdateDebt(id, updates) {
  useDebtStore.setState((s) => ({
    debts: s.debts.map((d) => {
      if (d.id !== id) return d;
      const next = { ...d, ...updates };
      if (updates.dueDate !== undefined) next.due_date = updates.dueDate || null;
      if (updates.currentBalance !== undefined) {
        next.currentBalance = Number(updates.currentBalance);
        next.status = next.currentBalance <= 0 ? 'paid_off' : 'active';
      }
      return next;
    }),
  }));
}
// Borra la deuda + sus pagos + las transacciones enlazadas de esos pagos (cascade).
export function demoDeleteDebt(id) {
  const { payments } = useDebtStore.getState();
  const txIds = payments.filter((p) => p.debtId === id && p.transactionId).map((p) => p.transactionId);
  if (txIds.length) useTransactionStore.setState((s) => ({ transactions: s.transactions.filter((t) => !txIds.includes(t.id)) }));
  useDebtStore.setState((s) => ({
    debts: s.debts.filter((d) => d.id !== id),
    payments: s.payments.filter((p) => p.debtId !== id),
  }));
}
// Restaura una deuda borrada con sus pagos; recrea las transacciones enlazadas.
export function demoRestoreDebt(debt, payments = []) {
  useDebtStore.setState((s) => ({ debts: [...s.debts, debt] }));
  for (const p of payments) {
    let transactionId = p.transactionId;
    if (transactionId) {
      // Recrea la transacción enlazada con su mismo id.
      const tx = {
        id: transactionId, categoryId: demoLoanCategoryId(), cardId: null,
        amount: Number(p.amount), type: 'fixed_expense', description: `Pago cuota - ${debt.creditorName}`,
        date: p.date, notes: p.notes || 'Generado automáticamente desde Deudas', currency: debt.currency || 'DOP',
        cashbackEarned: 0, createdAt: new Date().toISOString(),
      };
      useTransactionStore.setState((s) => ({ transactions: [tx, ...s.transactions] }));
    }
    useDebtStore.setState((s) => ({ payments: [...s.payments, p] }));
  }
}
export function demoAddDebtPayment(debtId, amount, date, notes = '', savingsUsed = []) {
  const { debts } = useDebtStore.getState();
  const debt = debts.find((d) => d.id === debtId);
  if (!debt) return null;
  const value = Number(amount) || 0;
  const newBalance = Math.max(0, Number(debt.currentBalance) - value);
  const newStatus = newBalance <= 0 ? 'paid_off' : 'active';

  // Transacción de gasto enlazada (base caja), igual que el store real.
  // Si la categoría de pago de deuda aún no existe (cuenta nueva sin semillas),
  // se crea al vuelo para que el abono sí entre al flujo de transacciones.
  let transactionId = null;
  let catId = demoLoanCategoryId();
  if (!catId) {
    const created = demoAddCategory({
      slug: 'pago-deuda', name: 'Pago de Préstamos y Deudas', type: 'fixed_expense',
      icon: '🏛️', color: '#dc2626',
      keywords: ['prestamo', 'prestamos', 'cuota', 'capital', 'abono a deuda', 'financiamiento', 'asociacion', 'cooperativa'],
    });
    catId = created?.id || demoLoanCategoryId();
  }
  if (catId) {
    transactionId = demoAddTransaction({
      amount: value, type: 'fixed_expense', description: `Pago cuota - ${debt.creditorName}`,
      date, categoryId: catId, currency: debt.currency || 'DOP', notes: notes || 'Generado automáticamente desde Deudas',
    });
  }
  const payment = { id: demoId(), debtId, amount: value, date, remainingBalance: newBalance, notes: notes || null, transactionId, savingsUsed, createdAt: new Date().toISOString() };
  useDebtStore.setState((s) => ({
    payments: [...s.payments, payment],
    debts: s.debts.map((d) => (d.id === debtId ? { ...d, currentBalance: newBalance, status: newStatus } : d)),
  }));
  return payment;
}

// Aplica un pago de deuda con cascada: si `savingsPick` ({ goalId, amount }) no es
// null, primero retira ese monto del ahorro (aporte negativo, que devuelve efectivo
// vía getLiquidCash) y luego registra el pago, anotando savingsUsed para la reversa.
export function applyDebtPaymentWithCascade(debtId, amount, date, notes, savingsPick) {
  const savingsUsed = [];
  if (savingsPick && savingsPick.amount > 0) {
    demoAddContribution(savingsPick.goalId, -Math.abs(savingsPick.amount), date, 'Retiro para pago de deuda');
    savingsUsed.push({ goalId: savingsPick.goalId, amount: Math.abs(savingsPick.amount) });
  }
  return demoAddDebtPayment(debtId, amount, date, notes, savingsUsed);
}

export function demoDeleteDebtPayment(paymentId) {
  const { payments, debts } = useDebtStore.getState();
  const payment = payments.find((p) => p.id === paymentId);
  if (!payment) return { ok: false };
  // Reversa de cascada: devuelve a cada meta lo que el pago tomó del ahorro.
  for (const s of payment.savingsUsed || []) {
    demoAddContribution(s.goalId, Math.abs(s.amount), payment.date, 'Reversa de retiro por pago');
  }
  const debt = debts.find((d) => d.id === payment.debtId);
  if (payment.transactionId) demoDeleteTransaction(payment.transactionId);
  useDebtStore.setState((s) => ({
    payments: s.payments.filter((p) => p.id !== paymentId),
    debts: debt
      ? s.debts.map((d) => {
          if (d.id !== debt.id) return d;
          const restored = Number(d.currentBalance) + Number(payment.amount);
          return { ...d, currentBalance: restored, status: restored > 0 ? 'active' : 'paid_off' };
        })
      : s.debts,
  }));
  return { ok: true, payment };
}

// ── Ahorros (metas + aportes) — en demo no hay sesión ─────────────────────────
// Resuelve la categoría de ahorro para enlazar la transacción del aporte.
function demoSavingsCategoryId() {
  const cats = useCategoryStore.getState().categories;
  const c = cats.find((x) => x.slug === 'ahorro') || cats.find((x) => x.type === 'savings');
  return c?.id || '';
}

export function demoAddGoal(goal) {
  const current = Number(goal.currentAmount) || 0;
  const row = {
    id: demoId(), title: goal.title,
    targetAmount: Number(goal.targetAmount), currentAmount: current,
    monthlyContribution: Number(goal.monthlyContribution) || 0,
    deadline: goal.deadline || null, icon: goal.icon || '🎯', color: goal.color || '#bec2ff',
    status: (current >= Number(goal.targetAmount) && Number(goal.targetAmount) > 0) ? 'completed' : 'active',
    currency: goal.currency || 'DOP', horizon: goal.horizon || null, createdAt: new Date().toISOString(),
  };
  useSavingsStore.setState((s) => ({ goals: [...s.goals, row] }));
  return row;
}
export function demoUpdateGoal(id, updates) {
  useSavingsStore.setState((s) => ({
    goals: s.goals.map((g) => {
      if (g.id !== id) return g;
      const next = { ...g, ...updates };
      const current = updates.currentAmount !== undefined ? Number(updates.currentAmount) : g.currentAmount;
      const target = updates.targetAmount !== undefined ? Number(updates.targetAmount) : g.targetAmount;
      next.currentAmount = current;
      next.targetAmount = target;
      next.status = (current >= target && target > 0) ? 'completed' : (updates.status || g.status);
      return next;
    }),
  }));
}
// Borra la meta + sus aportes + las transacciones enlazadas de esos aportes.
export function demoDeleteGoal(id) {
  const { contributions } = useSavingsStore.getState();
  const txIds = contributions.filter((c) => c.goalId === id && c.transactionId).map((c) => c.transactionId);
  if (txIds.length) useTransactionStore.setState((s) => ({ transactions: s.transactions.filter((t) => !txIds.includes(t.id)) }));
  useSavingsStore.setState((s) => ({
    goals: s.goals.filter((g) => g.id !== id),
    contributions: s.contributions.filter((c) => c.goalId !== id),
  }));
}
// Restaura una meta borrada con sus aportes; recrea las transacciones enlazadas.
export function demoRestoreGoal(goal, contributions = []) {
  useSavingsStore.setState((s) => ({ goals: [...s.goals, goal] }));
  for (const c of contributions) {
    if (c.transactionId) {
      const tx = {
        id: c.transactionId, categoryId: demoSavingsCategoryId(), cardId: null,
        amount: Number(c.amount), type: 'savings', description: `Aporte a meta - ${goal.title}`,
        date: c.date, notes: c.notes || 'Generado automáticamente desde Ahorros', currency: goal.currency || 'DOP',
        cashbackEarned: 0, createdAt: new Date().toISOString(),
      };
      useTransactionStore.setState((s) => ({ transactions: [tx, ...s.transactions] }));
    }
    useSavingsStore.setState((s) => ({ contributions: [...s.contributions, c] }));
  }
}
export function demoAddContribution(goalId, amount, date, notes = '') {
  const { goals } = useSavingsStore.getState();
  const goal = goals.find((g) => g.id === goalId);
  if (!goal) return null;
  const value = Number(amount) || 0;

  const catId = demoSavingsCategoryId();
  const transactionId = demoAddTransaction({
    amount: value, type: 'savings', description: `Aporte a meta - ${goal.title}`,
    date, categoryId: catId, currency: goal.currency || 'DOP',
    notes: notes || 'Generado automáticamente desde Ahorros',
  });

  const contrib = { id: demoId(), goalId, amount: value, date, notes: notes || null, transactionId, createdAt: new Date().toISOString() };
  const newAmount = Number(goal.currentAmount) + value;
  useSavingsStore.setState((s) => ({
    contributions: [...s.contributions, contrib],
    goals: s.goals.map((g) => (g.id === goalId ? { ...g, currentAmount: newAmount, status: (newAmount >= g.targetAmount && g.targetAmount > 0) ? 'completed' : g.status } : g)),
  }));
  return contrib;
}
export function demoDeleteContribution(id) {
  const { contributions, goals } = useSavingsStore.getState();
  const contrib = contributions.find((c) => c.id === id);
  if (!contrib) return { ok: false };
  const goal = goals.find((g) => g.id === contrib.goalId);
  if (contrib.transactionId) demoDeleteTransaction(contrib.transactionId);
  useSavingsStore.setState((s) => ({
    contributions: s.contributions.filter((c) => c.id !== id),
    goals: goal
      ? s.goals.map((g) => {
          if (g.id !== goal.id) return g;
          const restored = Math.max(0, Number(g.currentAmount) - Number(contrib.amount));
          return { ...g, currentAmount: restored, status: (restored >= g.targetAmount && g.targetAmount > 0) ? 'completed' : (g.status === 'completed' ? 'active' : g.status) };
        })
      : s.goals,
  }));
  return { ok: true, contribution: contrib };
}

// ── Categorías (en demo no hay sesión: el store sale sin efecto) ──────────────
export function demoAddCategory(category) {
  const row = {
    id: demoId(), name: category.name, type: category.type,
    icon: category.icon, color: category.color, slug: category.slug || null,
    keywords: category.keywords || [], isActive: true,
    sortOrder: useCategoryStore.getState().categories.length,
    createdAt: new Date().toISOString(),
    isAccumulative: false, accumulationStart: null,
  };
  useCategoryStore.setState((s) => ({
    categories: [...s.categories, row].sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' })),
  }));
  return row;
}
export function demoUpdateCategory(id, updates) {
  useCategoryStore.setState((s) => ({
    categories: s.categories.map((c) => (c.id === id ? { ...c, ...updates } : c)),
  }));
}
export function demoDeleteCategory(id) {
  useCategoryStore.setState((s) => ({ categories: s.categories.filter((c) => c.id !== id) }));
}
export function demoRestoreCategory(category) {
  useCategoryStore.setState((s) => ({
    categories: [...s.categories, category].sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' })),
  }));
}

// ── Efectivo inicial (demo) ───────────────────────────────────────────────────
// Lo escribe el campo "Efectivo inicial" en Ajustes. Solo memoria; no persiste.
export function demoSetInitialCashBalance(amount) {
  usePrefsStore.setState({ initialCashBalance: Number(amount) || 0 });
}

// ── Recordatorios de pago (demo) ─────────────────────────────────────────────
// Espejos de setRemindersEnabled / setReminderDaysBefore para que Ajustes no
// toque Supabase en demo. El cron nunca ve estos datos: los recordatorios reales
// salen de la tabla `profiles`, y el modo demo vive solo en sessionStorage.
export function demoSetRemindersEnabled(enabled) {
  usePrefsStore.setState({ remindersEnabled: Boolean(enabled) });
}

export function demoSetReminderDaysBefore(days) {
  if (!Array.isArray(days) || !days.length) return;
  usePrefsStore.setState({ reminderDaysBefore: days });
}
