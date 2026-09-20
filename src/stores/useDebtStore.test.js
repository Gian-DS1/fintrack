// Comportamiento del store de deudas en modo demo.
//
// Igual que en tarjetas (fase 5.1): el store resuelve el modo por dentro, así
// que los componentes llaman siempre a la misma acción. Estas pruebas fijan el
// estado resultante, que es el mismo que producían los mutadores de demoMode.
//
// No hay red: en demo el store nunca llama a Supabase.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import useDebtStore from './useDebtStore';
import useSavingsStore from './useSavingsStore';
import useCategoryStore from './useCategoryStore';
import useTransactionStore from './useTransactionStore';

vi.mock('../stitch/demoMode', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, isDemoActive: () => true };
});

const baseDebt = {
  creditorName: 'Banco Popular',
  originalAmount: 100000,
  currentBalance: 100000,
  interestRate: 12,
  monthlyPayment: 5000,
  dueDate: '2027-01-15',
  currency: 'DOP',
};

beforeEach(() => {
  useDebtStore.setState({ debts: [], payments: [], loading: false });
  useSavingsStore.setState({ goals: [], contributions: [], loading: false });
  useTransactionStore.setState({ transactions: [], loading: false });
  // Categoría de pago de deuda ya existente: addPayment la reusa en vez de
  // intentar crearla (ensureCategory sí tocaría Supabase).
  useCategoryStore.setState({
    categories: [{ id: 'cat-deuda', slug: 'pago-deuda', name: 'Pago de Préstamos y Deudas', type: 'fixed_expense' }],
    loading: false,
  });
});

const debts = () => useDebtStore.getState().debts;
const payments = () => useDebtStore.getState().payments;
const store = () => useDebtStore.getState();

describe('deudas en demo — alta, edición y borrado', () => {
  it('añade una deuda con id generado y estado activo', async () => {
    const row = await store().addDebt(baseDebt);

    expect(debts()).toHaveLength(1);
    expect(row.id).toBeTruthy();
    expect(debts()[0]).toMatchObject({
      creditorName: 'Banco Popular',
      originalAmount: 100000,
      currentBalance: 100000,
      status: 'active',
    });
  });

  it('marca paid_off si nace con saldo cero', async () => {
    await store().addDebt({ ...baseDebt, currentBalance: 0 });

    expect(debts()[0].status).toBe('paid_off');
  });

  it('edita solo la deuda indicada y recalcula el estado por saldo', async () => {
    const a = await store().addDebt(baseDebt);
    const b = await store().addDebt({ ...baseDebt, creditorName: 'BHD' });

    await store().updateDebt(a.id, { currentBalance: 0 });

    expect(debts().find((d) => d.id === a.id).status).toBe('paid_off');
    expect(debts().find((d) => d.id === b.id).status).toBe('active');
  });

  it('borra la deuda junto con sus pagos', async () => {
    const row = await store().addDebt(baseDebt);
    await store().addPayment(row.id, 5000, '2026-05-01');
    expect(payments()).toHaveLength(1);

    await store().deleteDebt(row.id);

    expect(debts()).toHaveLength(0);
    expect(payments()).toHaveLength(0);
  });

  it('conserva el id al restaurar una deuda borrada (deshacer)', async () => {
    const row = await store().addDebt(baseDebt);
    const snapshot = debts()[0];

    await store().deleteDebt(row.id);
    await store().addDebt(snapshot);

    expect(debts()).toHaveLength(1);
    expect(debts()[0].id).toBe(row.id);
  });
});

describe('deudas en demo — pagos', () => {
  it('baja el saldo y enlaza la transacción del pago', async () => {
    const row = await store().addDebt(baseDebt);

    await store().addPayment(row.id, 5000, '2026-05-01', 'Cuota mayo');

    expect(debts()[0].currentBalance).toBe(95000);
    expect(payments()).toHaveLength(1);
    expect(payments()[0]).toMatchObject({ amount: 5000, remainingBalance: 95000 });
    // El pago genera su transacción de gasto fijo y queda enlazado a ella.
    expect(payments()[0].transactionId).toBeTruthy();
    expect(useTransactionStore.getState().transactions).toHaveLength(1);
  });

  it('marca la deuda como saldada cuando el pago cubre el saldo', async () => {
    const row = await store().addDebt({ ...baseDebt, currentBalance: 3000 });

    await store().addPayment(row.id, 3000, '2026-05-01');

    expect(debts()[0].currentBalance).toBe(0);
    expect(debts()[0].status).toBe('paid_off');
  });

  it('borrar un pago devuelve el saldo y elimina su transacción', async () => {
    const row = await store().addDebt(baseDebt);
    await store().addPayment(row.id, 5000, '2026-05-01');
    const payment = payments()[0];

    const res = await store().deletePayment(payment.id);

    expect(res.ok).toBe(true);
    expect(debts()[0].currentBalance).toBe(100000);
    expect(payments()).toHaveLength(0);
    expect(useTransactionStore.getState().transactions).toHaveLength(0);
  });
});

describe('deudas en demo — cascada contra ahorros', () => {
  const withGoal = () => useSavingsStore.setState({
    goals: [{ id: 'g1', title: 'Fondo', currentAmount: 10000, targetAmount: 50000, currency: 'DOP', status: 'active' }],
    contributions: [],
  });

  it('descuenta de la meta al pagar con cascada y lo devuelve al borrar el pago', async () => {
    withGoal();
    const row = await store().addDebt(baseDebt);

    await store().addPaymentWithCascade(row.id, 4000, '2026-05-10', '', { goalId: 'g1', amount: 4000 });

    expect(payments()[0].savingsUsed).toEqual([{ goalId: 'g1', amount: 4000 }]);
    expect(useSavingsStore.getState().goals[0].currentAmount).toBe(6000);

    await store().deletePayment(payments()[0].id);

    expect(useSavingsStore.getState().goals[0].currentAmount).toBe(10000);
    expect(debts()[0].currentBalance).toBe(100000);
  });

  it('sin pick de ahorro no toca las metas', async () => {
    withGoal();
    const row = await store().addDebt(baseDebt);

    await store().addPaymentWithCascade(row.id, 4000, '2026-05-10', '', null);

    expect(useSavingsStore.getState().goals[0].currentAmount).toBe(10000);
    expect(payments()).toHaveLength(1);
  });
});
