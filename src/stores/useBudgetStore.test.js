// Comportamiento del store de presupuestos en modo demo.
//
// Los casos de "copiar del mes anterior" venían de demoMode.test.js, donde
// probaban el mutador demoCopyBudgetFromPreviousMonth. Tras la fase 5 la lógica
// vive en el store y vale igual con sesión, así que se prueban aquí.
//
// No hay red: en demo el store nunca llama a Supabase.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import useBudgetStore from './useBudgetStore';

vi.mock('../stitch/demoFlag', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, isDemoActive: () => true };
});

const row = (id, categoryId, year, month, estimatedAmount) => ({
  id, categoryId, year, month, estimatedAmount, currency: 'DOP', createdAt: '2026-01-01T00:00:00Z',
});

const budgets = () => useBudgetStore.getState().budgets;
const store = () => useBudgetStore.getState();
const monthOf = (year, month) => budgets().filter((b) => b.year === year && b.month === month);

beforeEach(() => {
  useBudgetStore.setState({ budgets: [] });
});

describe('setBudget en demo', () => {
  it('crea la fila del mes si no existía', async () => {
    await store().setBudget('cat-a', 2026, 5, 4000);

    expect(monthOf(2026, 5)).toHaveLength(1);
    expect(monthOf(2026, 5)[0].estimatedAmount).toBe(4000);
  });

  it('pisa el monto de una fila ya existente en vez de duplicarla', async () => {
    await store().setBudget('cat-a', 2026, 5, 4000);
    await store().setBudget('cat-a', 2026, 5, 7500);

    expect(monthOf(2026, 5)).toHaveLength(1);
    expect(monthOf(2026, 5)[0].estimatedAmount).toBe(7500);
  });

  it('no toca el mismo sobre en otro mes', async () => {
    await store().setBudget('cat-a', 2026, 4, 1000);
    await store().setBudget('cat-a', 2026, 5, 2000);

    expect(monthOf(2026, 4)[0].estimatedAmount).toBe(1000);
    expect(monthOf(2026, 5)[0].estimatedAmount).toBe(2000);
  });
});

describe('copyBudgetFromPreviousMonth en demo', () => {
  it('pisa los montos existentes del mes destino con los del mes anterior', async () => {
    useBudgetStore.setState({
      budgets: [
        row('p1', 'cat-a', 2026, 4, 5000),
        row('p2', 'cat-b', 2026, 4, 1200),
        // Fila ya existente en el mes destino (quedó en 0 al tocar el sobre).
        row('c1', 'cat-a', 2026, 5, 0),
      ],
    });

    expect(await store().copyBudgetFromPreviousMonth(2026, 5)).toBe(true);

    const dest = monthOf(2026, 5);
    expect(dest.find((b) => b.categoryId === 'cat-a').estimatedAmount).toBe(5000);
    expect(dest.find((b) => b.categoryId === 'cat-b').estimatedAmount).toBe(1200);
    expect(dest).toHaveLength(2);
  });

  it('no toca categorías del mes destino que no existían el mes anterior', async () => {
    useBudgetStore.setState({
      budgets: [
        row('p1', 'cat-a', 2026, 4, 5000),
        row('c1', 'cat-z', 2026, 5, 800),
      ],
    });

    expect(await store().copyBudgetFromPreviousMonth(2026, 5)).toBe(true);

    const dest = monthOf(2026, 5);
    expect(dest.find((b) => b.categoryId === 'cat-z').estimatedAmount).toBe(800);
    expect(dest.find((b) => b.categoryId === 'cat-a').estimatedAmount).toBe(5000);
  });

  it('cruza el año: enero copia de diciembre del año anterior', async () => {
    useBudgetStore.setState({ budgets: [row('p1', 'cat-a', 2025, 11, 3000)] });

    expect(await store().copyBudgetFromPreviousMonth(2026, 0)).toBe(true);

    expect(monthOf(2026, 0).find((b) => b.categoryId === 'cat-a').estimatedAmount).toBe(3000);
  });

  it('devuelve false si el mes anterior no tiene presupuesto', async () => {
    expect(await store().copyBudgetFromPreviousMonth(2026, 5)).toBe(false);
  });
});

describe('deleteBudget en demo', () => {
  it('quita solo la fila indicada', async () => {
    useBudgetStore.setState({
      budgets: [row('b1', 'cat-a', 2026, 5, 1000), row('b2', 'cat-b', 2026, 5, 2000)],
    });

    await store().deleteBudget('b1');

    expect(budgets()).toHaveLength(1);
    expect(budgets()[0].id).toBe('b2');
  });
});
