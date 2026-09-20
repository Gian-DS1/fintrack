// Comportamiento del store de ahorros en modo demo.
//
// Cierra la fase 5 junto a tarjetas y deudas: el store resuelve el modo por
// dentro y los componentes llaman siempre a la misma acción. Estas pruebas
// fijan el estado resultante, que es el que producían los mutadores de demoMode.
//
// No hay red: en demo el store nunca llama a Supabase.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import useSavingsStore from './useSavingsStore';
import useCategoryStore from './useCategoryStore';
import useTransactionStore from './useTransactionStore';

vi.mock('../stitch/demoMode', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, isDemoActive: () => true };
});

const baseGoal = {
  title: 'Fondo de emergencia',
  targetAmount: 50000,
  currentAmount: 0,
  monthlyContribution: 5000,
  deadline: '2027-06-30',
  icon: '🛟',
  color: '#22c55e',
  currency: 'DOP',
  horizon: 'medium',
};

beforeEach(() => {
  useSavingsStore.setState({ goals: [], contributions: [], loading: false });
  useTransactionStore.setState({ transactions: [], loading: false });
  useCategoryStore.setState({
    categories: [{ id: 'cat-ahorro', slug: 'ahorro', name: 'Ahorro', type: 'savings' }],
    loading: false,
  });
});

const goals = () => useSavingsStore.getState().goals;
const contributions = () => useSavingsStore.getState().contributions;
const store = () => useSavingsStore.getState();

describe('metas en demo — alta, edición y borrado', () => {
  it('crea una meta con id generado y estado activo', async () => {
    const row = await store().addGoal(baseGoal);

    expect(goals()).toHaveLength(1);
    expect(row.id).toBeTruthy();
    expect(goals()[0]).toMatchObject({
      title: 'Fondo de emergencia',
      targetAmount: 50000,
      currentAmount: 0,
      status: 'active',
    });
  });

  it('nace completed si el saldo inicial ya cubre la meta', async () => {
    await store().addGoal({ ...baseGoal, currentAmount: 50000 });

    expect(goals()[0].status).toBe('completed');
  });

  it('edita solo la meta indicada', async () => {
    const a = await store().addGoal(baseGoal);
    const b = await store().addGoal({ ...baseGoal, title: 'Viaje' });

    await store().updateGoal(a.id, { title: 'Fondo ampliado' });

    expect(goals().find((g) => g.id === a.id).title).toBe('Fondo ampliado');
    expect(goals().find((g) => g.id === b.id).title).toBe('Viaje');
  });

  it('togglePause alterna entre pausada y activa', async () => {
    const row = await store().addGoal(baseGoal);

    await store().togglePause(row.id);
    expect(goals()[0].status).toBe('paused');

    await store().togglePause(row.id);
    expect(goals()[0].status).toBe('active');
  });

  it('borra la meta junto con sus aportes y las transacciones enlazadas', async () => {
    const row = await store().addGoal(baseGoal);
    await store().addContribution(row.id, 5000, '2026-05-01');
    expect(useTransactionStore.getState().transactions).toHaveLength(1);

    await store().deleteGoal(row.id);

    expect(goals()).toHaveLength(0);
    expect(contributions()).toHaveLength(0);
    expect(useTransactionStore.getState().transactions).toHaveLength(0);
  });
});

describe('metas en demo — aportes', () => {
  it('suma al saldo y enlaza la transacción de ahorro', async () => {
    const row = await store().addGoal(baseGoal);

    await store().addContribution(row.id, 5000, '2026-05-01', 'Primer aporte');

    expect(goals()[0].currentAmount).toBe(5000);
    expect(contributions()).toHaveLength(1);
    expect(contributions()[0].transactionId).toBeTruthy();
    expect(useTransactionStore.getState().transactions).toHaveLength(1);
  });

  it('completa la meta cuando el aporte alcanza el objetivo', async () => {
    const row = await store().addGoal({ ...baseGoal, targetAmount: 10000 });

    await store().addContribution(row.id, 10000, '2026-05-01');

    expect(goals()[0].status).toBe('completed');
  });

  it('borrar un aporte revierte el saldo y su transacción', async () => {
    const row = await store().addGoal(baseGoal);
    await store().addContribution(row.id, 5000, '2026-05-01');

    const res = await store().deleteContribution(contributions()[0].id);

    expect(res.ok).toBe(true);
    expect(goals()[0].currentAmount).toBe(0);
    expect(contributions()).toHaveLength(0);
    expect(useTransactionStore.getState().transactions).toHaveLength(0);
  });

  it('un aporte negativo (retiro de la cascada) baja el saldo', async () => {
    const row = await store().addGoal({ ...baseGoal, currentAmount: 10000 });

    await store().addContribution(row.id, -4000, '2026-05-10', 'Retiro para pago');

    expect(goals()[0].currentAmount).toBe(6000);
  });
});

describe('metas en demo — deshacer el borrado', () => {
  it('restaura la meta con su id y sus aportes', async () => {
    const row = await store().addGoal(baseGoal);
    await store().addContribution(row.id, 5000, '2026-05-01');
    const goalSnapshot = goals()[0];
    const contribSnapshot = contributions().filter((c) => c.goalId === row.id);

    await store().deleteGoal(row.id);
    expect(goals()).toHaveLength(0);

    await store().restoreGoalWithContributions(goalSnapshot, contribSnapshot);

    expect(goals()).toHaveLength(1);
    expect(goals()[0].id).toBe(row.id);
    // El saldo se restaura tal cual, sin re-sumar los aportes.
    expect(goals()[0].currentAmount).toBe(5000);
    expect(contributions()).toHaveLength(1);
  });
});
