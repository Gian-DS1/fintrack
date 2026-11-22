// Siembra del modo demo. La copia de presupuesto del mes anterior se probaba
// aquí sobre el mutador demoCopyBudgetFromPreviousMonth; tras la fase 5 vive en
// useBudgetStore y sus pruebas están en stores/useBudgetStore.test.js.
import { describe, it, expect, vi, afterEach } from 'vitest';
import useCategoryStore from '../stores/useCategoryStore';
import useTransactionStore from '../stores/useTransactionStore';
import useSavingsStore from '../stores/useSavingsStore';
import useDebtStore from '../stores/useDebtStore';
import useCreditCardStore from '../stores/useCreditCardStore';
import usePrefsStore from '../stores/usePrefsStore';
import useRecurringStore from '../stores/useRecurringStore';
import { seedFreshStores, exitDemo } from './demoMode';
import { simulationKey } from './screens/projection/simulationStorage';
import { getRealMoney } from './screens/dashboard/selectors';
import { getCardBalances } from '../utils/creditCards';
import { projectRealMoney } from '../utils/cashflowProjection';

// Espía de red: la siembra del demo vive en memoria y no puede tocar Supabase.
const { fromSpy, rpcSpy } = vi.hoisted(() => ({ fromSpy: vi.fn(), rpcSpy: vi.fn() }));
vi.mock('../lib/supabase', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, supabase: { ...actual.supabase, from: fromSpy, rpc: rpcSpy } };
});

describe('seedFreshStores', () => {
  it('deja todos los stores vacios y la moneda sin elegir', () => {
    // Ensuciar los stores primero para probar que se vacían.
    useCategoryStore.setState({ categories: [{ id: 'x', name: 'X' }], loading: true });
    useTransactionStore.setState({ transactions: [{ id: 't' }], loading: true });
    useSavingsStore.setState({ goals: [{ id: 'g' }], contributions: [{ id: 'c' }], loading: true });
    useDebtStore.setState({ debts: [{ id: 'd' }], payments: [{ id: 'p' }], loading: true });
    useCreditCardStore.setState({ cards: [{ id: 'cc' }], loading: true });
    usePrefsStore.setState({ currency: 'DOP', tutorialSeen: true });
    useRecurringStore.setState({ recurring: [{ id: 'r' }] });

    seedFreshStores();

    expect(useCategoryStore.getState().categories).toEqual([]);
    expect(useTransactionStore.getState().transactions).toEqual([]);
    expect(useSavingsStore.getState().goals).toEqual([]);
    expect(useSavingsStore.getState().contributions).toEqual([]);
    expect(useDebtStore.getState().debts).toEqual([]);
    expect(useDebtStore.getState().payments).toEqual([]);
    expect(useCreditCardStore.getState().cards).toEqual([]);
    expect(useRecurringStore.getState().recurring).toEqual([]);
    expect(usePrefsStore.getState().currency).toBeNull();
    expect(usePrefsStore.getState().tutorialSeen).toBe(false);
    expect(useCategoryStore.getState().loading).toBe(false);
  });
});

// demoMode.js fija "hoy" al cargar el módulo y siembra datos relativos a esa
// fecha. Para probar varias fechas del calendario se congela el reloj y se
// importa el módulo (y sus stores) de nuevo en cada una.
async function seedDemoAt(date) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(date);
  vi.resetModules();
  fromSpy.mockClear();
  rpcSpy.mockClear();
  const demo = await import('./demoMode');
  const { default: cards } = await import('../stores/useCreditCardStore');
  const { default: txs } = await import('../stores/useTransactionStore');
  const { default: prefs } = await import('../stores/usePrefsStore');
  const { default: recurring } = await import('../stores/useRecurringStore');
  demo.seedDemoStores();
  return {
    cards: cards.getState().cards,
    recurring: recurring.getState().recurring,
    transactions: txs.getState().transactions,
    initialCashBalance: prefs.getState().initialCashBalance,
  };
}

describe('seedDemoStores · dinero real', () => {
  afterEach(() => vi.useRealTimers());

  // Fechas que cruzan el corte (20) y el pago (5) de la tarjeta demo, el inicio y
  // el fin de mes y el cambio de año.
  const fechas = [
    new Date(2026, 0, 3), new Date(2026, 1, 28), new Date(2026, 3, 5), new Date(2026, 4, 6),
    new Date(2026, 4, 20), new Date(2026, 4, 21), new Date(2026, 10, 20), new Date(2026, 11, 31),
  ];

  it.each(fechas)('el demo NO arranca en estado crítico (%s)', async (hoy) => {
    const seed = await seedDemoAt(hoy);
    const r = getRealMoney(seed.transactions, seed.initialCashBalance, seed.cards, hoy);
    expect(r.isCritical).toBe(false);
    expect(r.realMoney).toBeGreaterThan(0);
    expect(r.cardsWithoutCycle).toBe(0);
  });

  it('la tarjeta demo trae abonos por los ciclos ya cerrados, todos con fecha ≤ hoy', async () => {
    const hoy = new Date(2026, 4, 28);
    const { cards } = await seedDemoAt(hoy);
    const payments = cards.find((c) => c.id === 'cc1').payments;
    expect(payments.length).toBeGreaterThanOrEqual(3);
    expect(payments.every((p) => p.amount > 0 && p.date <= '2026-05-28')).toBe(true);
  });

  it('la tarjeta demo no arrastra consumo de ciclos anteriores sin pagar', async () => {
    for (const hoy of [new Date(2026, 4, 28), new Date(2026, 5, 4), new Date(2026, 5, 6)]) {
      const { cards, transactions } = await seedDemoAt(hoy);
      const card = cards.find((c) => c.id === 'cc1');
      expect(getCardBalances(card, transactions, hoy).spansMultipleCycles).toBe(false);
    }
  });

  it('la siembra no llama a Supabase', async () => {
    await seedDemoAt(new Date(2026, 4, 28));
    expect(fromSpy).not.toHaveBeenCalled();
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});

describe('seedDemoStores · recurrentes para la proyección', () => {
  afterEach(() => vi.useRealTimers());

  const fechas = [new Date(2026, 4, 28), new Date(2026, 0, 1), new Date(2026, 11, 31), new Date(2026, 1, 28)];

  it.each(fechas)('siembra ingresos y gastos recurrentes activos, con próxima fecha posterior a hoy y sin tarjeta (%s)', async (hoy) => {
    const { recurring } = await seedDemoAt(hoy);
    const hoyISO = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    expect(recurring.some((r) => r.type === 'income')).toBe(true);
    expect(recurring.filter((r) => r.type === 'fixed_expense').length).toBeGreaterThanOrEqual(2);
    for (const r of recurring) {
      expect(r.active).toBe(true);
      expect(r.cardId).toBeNull();
      // La ocurrencia de hoy ya está en el historial: la plantilla sigue en la siguiente.
      expect(r.nextDate > hoyISO).toBe(true);
    }
  });

  it.each(fechas)('la proyección del demo tiene ingresos y no arranca en negativo (%s)', async (hoy) => {
    const seed = await seedDemoAt(hoy);
    const r = projectRealMoney({
      transactions: seed.transactions, initialCashBalance: seed.initialCashBalance, cards: seed.cards,
      recurring: seed.recurring, debts: [], debtPayments: [], currency: 'DOP', refDate: hoy,
    });
    expect(r.hasRecurringIncome).toBe(true);
    expect(r.start).toBeGreaterThan(0);
    expect(r.base.variableMonthsUsed).toBeGreaterThan(0);
  });

  it('el día 1 el salario de hoy no se cuenta dos veces en el mes en curso', async () => {
    const hoy = new Date(2026, 0, 1);
    const seed = await seedDemoAt(hoy);
    expect(seed.transactions.filter((t) => t.date === '2026-01-01' && t.type === 'income')).toHaveLength(1);
    const r = projectRealMoney({
      transactions: seed.transactions, initialCashBalance: seed.initialCashBalance, cards: seed.cards,
      recurring: seed.recurring, debts: [], debtPayments: [], currency: 'DOP', refDate: hoy,
    });
    // Solo queda el salario del día 15: el del día 1 ya está en las transacciones.
    expect(r.points[0].income).toBe(85000);
  });
});

describe('exitDemo · simulación de la proyección', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('al salir del demo se borra la simulación guardada del dispositivo', () => {
    const data = { [simulationKey('demo')]: '{"scenario":"cuts"}', otra: '1' };
    vi.stubGlobal('localStorage', {
      get length() { return Object.keys(data).length; },
      key: (i) => Object.keys(data)[i] ?? null,
      getItem: (k) => data[k] ?? null,
      setItem: (k, v) => { data[k] = String(v); },
      removeItem: (k) => { delete data[k]; },
    });
    vi.stubGlobal('sessionStorage', { removeItem: () => {}, getItem: () => null, setItem: () => {} });
    exitDemo();
    expect(Object.keys(data)).toEqual(['otra']);
  });
});
