// Siembra del modo demo. La copia de presupuesto del mes anterior se probaba
// aquí sobre el mutador demoCopyBudgetFromPreviousMonth; tras la fase 5 vive en
// useBudgetStore y sus pruebas están en stores/useBudgetStore.test.js.
import { describe, it, expect } from 'vitest';
import useCategoryStore from '../stores/useCategoryStore';
import useTransactionStore from '../stores/useTransactionStore';
import useSavingsStore from '../stores/useSavingsStore';
import useDebtStore from '../stores/useDebtStore';
import useCreditCardStore from '../stores/useCreditCardStore';
import usePrefsStore from '../stores/usePrefsStore';
import { seedFreshStores } from './demoMode';

describe('seedFreshStores', () => {
  it('deja todos los stores vacios y la moneda sin elegir', () => {
    // Ensuciar los stores primero para probar que se vacían.
    useCategoryStore.setState({ categories: [{ id: 'x', name: 'X' }], loading: true });
    useTransactionStore.setState({ transactions: [{ id: 't' }], loading: true });
    useSavingsStore.setState({ goals: [{ id: 'g' }], contributions: [{ id: 'c' }], loading: true });
    useDebtStore.setState({ debts: [{ id: 'd' }], payments: [{ id: 'p' }], loading: true });
    useCreditCardStore.setState({ cards: [{ id: 'cc' }], loading: true });
    usePrefsStore.setState({ currency: 'DOP', tutorialSeen: true });

    seedFreshStores();

    expect(useCategoryStore.getState().categories).toEqual([]);
    expect(useTransactionStore.getState().transactions).toEqual([]);
    expect(useSavingsStore.getState().goals).toEqual([]);
    expect(useSavingsStore.getState().contributions).toEqual([]);
    expect(useDebtStore.getState().debts).toEqual([]);
    expect(useDebtStore.getState().payments).toEqual([]);
    expect(useCreditCardStore.getState().cards).toEqual([]);
    expect(usePrefsStore.getState().currency).toBeNull();
    expect(usePrefsStore.getState().tutorialSeen).toBe(false);
    expect(useCategoryStore.getState().loading).toBe(false);
  });
});
