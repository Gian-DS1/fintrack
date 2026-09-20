// Comportamiento del store de tarjetas en modo demo.
//
// Antes de la fase 5 estas operaciones vivían en los mutadores de demoMode y
// cada componente elegía rama con `if (demo)`. Ahora el store resuelve el modo
// por dentro, así que los componentes llaman siempre a la misma acción. Estas
// pruebas fijan el estado resultante, que es el mismo que producía demoMode.
//
// No hay red: en demo el store nunca llama a Supabase.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import useCreditCardStore from './useCreditCardStore';
import useSavingsStore from './useSavingsStore';
import useTransactionStore from './useTransactionStore';

// isDemoActive() mira window.location + sessionStorage, que no existen en el
// entorno `node` de vitest. Lo forzamos a true: lo que se prueba aquí es la
// rama demo del store, no cómo se detecta el modo.
vi.mock('../stitch/demoMode', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, isDemoActive: () => true };
});

const baseCard = {
  name: 'Popular Visa',
  bank: 'Popular',
  cutoffDay: 15,
  dueDay: 5,
  color: '#bec2ff',
  openingBalance: 1200,
  cashbackRules: [],
  catalogId: null,
};

beforeEach(() => {
  useCreditCardStore.setState({ cards: [], loading: false });
  useSavingsStore.setState({ goals: [], contributions: [], loading: false });
});

const cards = () => useCreditCardStore.getState().cards;
const store = () => useCreditCardStore.getState();

describe('tarjetas en demo — alta, edición y borrado', () => {
  it('añade una tarjeta con id generado y los defaults del shape', async () => {
    const row = await store().addCard(baseCard);

    expect(cards()).toHaveLength(1);
    expect(row.id).toBeTruthy();
    expect(cards()[0]).toMatchObject({
      name: 'Popular Visa',
      bank: 'Popular',
      cutoffDay: 15,
      dueDay: 5,
      openingBalance: 1200,
    });
    // Toda tarjeta nace con estas colecciones vacías, no undefined.
    expect(cards()[0].paidCycles).toEqual([]);
    expect(cards()[0].payments).toEqual([]);
  });

  it('normaliza a número los días de corte y pago', async () => {
    await store().addCard({ ...baseCard, cutoffDay: '20', dueDay: '10', openingBalance: '500' });

    expect(cards()[0].cutoffDay).toBe(20);
    expect(cards()[0].dueDay).toBe(10);
    expect(cards()[0].openingBalance).toBe(500);
  });

  it('edita solo la tarjeta indicada', async () => {
    const a = await store().addCard(baseCard);
    const b = await store().addCard({ ...baseCard, name: 'BHD Mastercard' });

    await store().updateCard(a.id, { name: 'Popular Visa Signature' });

    expect(cards().find((c) => c.id === a.id).name).toBe('Popular Visa Signature');
    expect(cards().find((c) => c.id === b.id).name).toBe('BHD Mastercard');
  });

  it('borra solo la tarjeta indicada', async () => {
    const a = await store().addCard(baseCard);
    const b = await store().addCard({ ...baseCard, name: 'BHD Mastercard' });

    await store().deleteCard(a.id);

    expect(cards()).toHaveLength(1);
    expect(cards()[0].id).toBe(b.id);
  });

  it('conserva el id y los abonos al restaurar una tarjeta borrada (deshacer)', async () => {
    const row = await store().addCard(baseCard);
    await store().addCardPayment(row.id, { amount: 800, date: '2026-05-03' });
    const snapshot = cards()[0];

    await store().deleteCard(row.id);
    expect(cards()).toHaveLength(0);

    // El Deshacer reinserta el objeto completo: debe recuperar su id original,
    // igual que hacía demoRestoreCard antes de la migración.
    await store().addCard(snapshot);

    expect(cards()).toHaveLength(1);
    expect(cards()[0].id).toBe(row.id);
    expect(cards()[0].payments).toHaveLength(1);
    expect(cards()[0].payments[0].amount).toBe(800);
  });
});

describe('tarjetas en demo — abonos', () => {
  it('registra un abono en la tarjeta correcta', async () => {
    const row = await store().addCard(baseCard);

    await store().addCardPayment(row.id, { amount: 3000, date: '2026-05-10', note: 'Abono' });

    expect(cards()[0].payments).toHaveLength(1);
    expect(cards()[0].payments[0]).toMatchObject({ amount: 3000, date: '2026-05-10', note: 'Abono' });
  });

  it('ignora abonos de importe no positivo', async () => {
    const row = await store().addCard(baseCard);

    await store().addCardPayment(row.id, { amount: 0 });
    await store().addCardPayment(row.id, { amount: -50 });

    expect(cards()[0].payments).toHaveLength(0);
  });

  it('elimina un abono concreto y deja los demás', async () => {
    const row = await store().addCard(baseCard);
    await store().addCardPayment(row.id, { amount: 1000, date: '2026-05-01' });
    await store().addCardPayment(row.id, { amount: 2000, date: '2026-05-02' });

    const first = cards()[0].payments[0];
    await store().deleteCardPayment(row.id, first.id);

    expect(cards()[0].payments).toHaveLength(1);
    expect(cards()[0].payments[0].amount).toBe(2000);
  });

  it('no registra abonos contra una tarjeta inexistente', async () => {
    await store().addCard(baseCard);

    await store().addCardPayment('no-existe', { amount: 500, date: '2026-05-01' });

    expect(cards()[0].payments).toHaveLength(0);
  });
});

describe('tarjetas en demo — cascada contra ahorros', () => {
  const withGoal = () => useSavingsStore.setState({
    goals: [{ id: 'g1', title: 'Fondo', currentAmount: 10000, targetAmount: 50000, currency: 'DOP', status: 'active' }],
    contributions: [],
  });

  it('descuenta de la meta al pagar con cascada y lo devuelve al borrar el abono', async () => {
    withGoal();
    const row = await store().addCard(baseCard);

    await store().addCardPaymentWithCascade(
      row.id,
      { amount: 4000, date: '2026-05-10', note: 'Pago' },
      { goalId: 'g1', amount: 4000 },
    );

    const entry = cards()[0].payments[0];
    expect(entry.savingsUsed).toEqual([{ goalId: 'g1', amount: 4000 }]);
    expect(useSavingsStore.getState().goals[0].currentAmount).toBe(6000);

    // Borrar el abono revierte el retiro: la meta vuelve a su saldo anterior.
    await store().deleteCardPayment(row.id, entry.id);

    expect(useSavingsStore.getState().goals[0].currentAmount).toBe(10000);
    expect(cards()[0].payments).toHaveLength(0);
  });

  it('sin pick de ahorro no toca las metas', async () => {
    withGoal();
    const row = await store().addCard(baseCard);

    await store().addCardPaymentWithCascade(row.id, { amount: 4000, date: '2026-05-10' }, null);

    expect(useSavingsStore.getState().goals[0].currentAmount).toBe(10000);
    expect(cards()[0].payments).toHaveLength(1);
  });
});

describe('tarjetas en demo — la cascada enlaza su transacción de ahorro', () => {
  it('el retiro genera una transacción y borrarlo la elimina', async () => {
    useSavingsStore.setState({
      goals: [{ id: 'g1', title: 'Fondo', currentAmount: 10000, targetAmount: 50000, currency: 'DOP', status: 'active' }],
      contributions: [],
    });
    useTransactionStore.setState({ transactions: [], loading: false });
    const row = await store().addCard(baseCard);

    await store().addCardPaymentWithCascade(
      row.id,
      { amount: 4000, date: '2026-05-10' },
      { goalId: 'g1', amount: 4000 },
    );

    // El aporte negativo del retiro queda enlazado a una transacción de ahorro.
    const contrib = useSavingsStore.getState().contributions[0];
    expect(contrib.amount).toBe(-4000);
    expect(contrib.transactionId).toBeTruthy();
    expect(useTransactionStore.getState().transactions).toHaveLength(1);

    await store().deleteCardPayment(row.id, cards()[0].payments[0].id);

    // La reversa deja la meta como estaba y no arrastra transacciones huérfanas.
    expect(useSavingsStore.getState().goals[0].currentAmount).toBe(10000);
    expect(useTransactionStore.getState().transactions).toHaveLength(2);
  });
});
