// Limpieza centralizada de datos de usuario en el cliente.
//
// Borra TANTO el estado en memoria de los stores Zustand COMO su caché
// persistida en sessionStorage. Debe correr en CUALQUIER fin de sesión
// (signOut manual, expiración de token, cierre desde otra pestaña), no solo
// en el botón de salir: si queda dato residual, otra persona que inicie
// sesión en la misma pestaña vería las finanzas del usuario anterior.
// También borra la simulación de «Proyección», guardada en localStorage.
//
// Se invoca desde AuthContext en el evento SIGNED_OUT de Supabase, que cubre
// todos los caminos anteriores.

import useTransactionStore from './useTransactionStore';
import useCategoryStore from './useCategoryStore';
import useBudgetStore from './useBudgetStore';
import useBudgetGroupStore from './useBudgetGroupStore';
import useSavingsStore from './useSavingsStore';
import useDebtStore from './useDebtStore';
import useCreditCardStore from './useCreditCardStore';
import useRecurringStore from './useRecurringStore';
import usePrefsStore from './usePrefsStore';
import { clearSimulations } from '../stitch/screens/projection/simulationStorage';

const RESETS = [
  [useTransactionStore, { transactions: [] }],
  [useCategoryStore, { categories: [] }],
  [useBudgetStore, { budgets: [] }],
  [useBudgetGroupStore, { groups: [] }],
  [useSavingsStore, { goals: [], contributions: [] }],
  [useDebtStore, { debts: [], payments: [] }],
  [useCreditCardStore, { cards: [] }],
  [useRecurringStore, { recurring: [] }],
  [usePrefsStore, { budgetLevel: 'tracking', tutorialSeen: false, currency: null, prefsLoaded: false, initialCashBalance: 0 }],
];

export function clearUserData() {
  for (const [store, initial] of RESETS) {
    store.setState(initial);
    store.persist.clearStorage();
  }
  // La simulación de «Proyección» vive en localStorage (por usuario): no sobrevive al fin de sesión.
  clearSimulations();
}
