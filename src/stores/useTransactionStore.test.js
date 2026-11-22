// El store descarta `cardId` en todo lo que no es gasto: solo un gasto puede
// quedar ligado a una tarjeta (defensa contra un `cardId` huérfano del formulario).
//
// No hay red: en demo el store nunca llama a Supabase.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import useTransactionStore from './useTransactionStore';

vi.mock('../stitch/demoFlag', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, isDemoActive: () => true };
});

const base = { categoryId: 'cat', amount: 100, description: 'x', date: '2026-05-10' };

beforeEach(() => {
  useTransactionStore.setState({ transactions: [], loading: false });
});

describe('addTransaction y cardId', () => {
  it('conserva cardId en un gasto', async () => {
    await useTransactionStore.getState().addTransaction({ ...base, type: 'variable_expense', cardId: 'c1' });
    expect(useTransactionStore.getState().transactions[0].cardId).toBe('c1');
  });

  it.each(['income', 'savings'])('descarta cardId en %s', async (type) => {
    await useTransactionStore.getState().addTransaction({ ...base, type, cardId: 'c1' });
    expect(useTransactionStore.getState().transactions[0].cardId).toBeNull();
  });
});

describe('updateTransaction y cardId', () => {
  const seed = (type) => useTransactionStore.setState({
    transactions: [{ id: 't1', ...base, type, cardId: type === 'variable_expense' ? 'c1' : null }],
  });

  it('al pasar un gasto con tarjeta a ingreso, quita la tarjeta', async () => {
    seed('variable_expense');
    await useTransactionStore.getState().updateTransaction('t1', { type: 'income', cardId: 'c1' });
    const t = useTransactionStore.getState().transactions[0];
    expect(t.type).toBe('income');
    expect(t.cardId).toBeNull();
  });

  it('al pasar un gasto con tarjeta a ahorro sin mandar cardId, también quita la tarjeta', async () => {
    seed('variable_expense');
    await useTransactionStore.getState().updateTransaction('t1', { type: 'savings' });
    expect(useTransactionStore.getState().transactions[0].cardId).toBeNull();
  });

  it('un gasto conserva su tarjeta al editarse', async () => {
    seed('variable_expense');
    await useTransactionStore.getState().updateTransaction('t1', { type: 'fixed_expense', cardId: 'c1' });
    expect(useTransactionStore.getState().transactions[0].cardId).toBe('c1');
  });
});

describe('bulkAssignCard y cardId', () => {
  it('asigna la tarjeta a los gastos y deja sin tarjeta los ingresos y ahorros', async () => {
    useTransactionStore.setState({
      transactions: [
        { id: 'g', ...base, type: 'fixed_expense', cardId: null },
        { id: 'i', ...base, type: 'income', cardId: null },
        { id: 's', ...base, type: 'savings', cardId: null },
      ],
    });
    await useTransactionStore.getState().bulkAssignCard(['g', 'i', 's'], 'c1');
    const byId = Object.fromEntries(useTransactionStore.getState().transactions.map((t) => [t.id, t.cardId]));
    expect(byId).toEqual({ g: 'c1', i: null, s: null });
  });

  it('al quitar la tarjeta (cardId vacío) todos quedan sin tarjeta', async () => {
    useTransactionStore.setState({ transactions: [{ id: 'g', ...base, type: 'expense', cardId: 'c1' }] });
    await useTransactionStore.getState().bulkAssignCard(['g'], '');
    expect(useTransactionStore.getState().transactions[0].cardId).toBeNull();
  });
});

describe('bulkAddTransactions y cardId', () => {
  it('conserva cardId en gastos y lo descarta en ingresos y ahorros', async () => {
    await useTransactionStore.getState().bulkAddTransactions([
      { ...base, type: 'variable_expense', cardId: 'c1' },
      { ...base, type: 'income', cardId: 'c1' },
      { ...base, type: 'savings', cardId: 'c1' },
    ]);
    const types = useTransactionStore.getState().transactions;
    const byType = Object.fromEntries(types.map((t) => [t.type, t.cardId]));
    expect(byType).toEqual({ variable_expense: 'c1', income: null, savings: null });
  });
});
