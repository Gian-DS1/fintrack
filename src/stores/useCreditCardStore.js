import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supabase, getCurrentUser } from '../lib/supabase';
import toast from 'react-hot-toast';
import { todayISO } from '../utils/formatters';
import useSavingsStore from './useSavingsStore';
import { tr } from '../i18n/runtime';
import { isDemoActive } from '../stitch/demoFlag';

// Id local para las filas creadas en modo demo (no hay Postgres que lo genere).
const localId = () =>
  (globalThis.crypto?.randomUUID?.() || `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`);

const mapFromDb = (c) => ({
  id: c.id,
  name: c.name,
  bank: c.bank || '',
  cutoffDay: Number(c.cutoff_day),
  dueDay: Number(c.due_day),
  color: c.color || '#6366f1',
  // Deuda previa al empezar a usar la app (consumos anteriores). Se suma a lo
  // por pagar; no es una transacción ni afecta el presupuesto. Default 0.
  openingBalance: Number(c.opening_balance) || 0,
  paidCycles: Array.isArray(c.paid_cycles) ? c.paid_cycles : [],
  payments: Array.isArray(c.payments) ? c.payments : [],
  cashbackRules: Array.isArray(c.cashback_rules) ? c.cashback_rules : [],
  catalogId: c.catalog_id || null,
  createdAt: c.created_at,
});

const useCreditCardStore = create(
  persist(
    (set, get) => ({
      cards: [],
      loading: false,

      fetchCards: async () => {
        if (isDemoActive()) return; // demo: los datos los siembra demoMode
        set({ loading: true });
        const user = await getCurrentUser();
        if (!user) return set({ cards: [], loading: false });

        const { data, error } = await supabase
          .from('credit_cards')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: true });

        if (!error && data) {
          set({ cards: data.map(mapFromDb), loading: false });
        } else {
          if (import.meta.env.DEV) console.error('Error fetching cards:', error);
          toast.error(tr('stores.cards.loadError'));
          set({ loading: false });
        }
      },

      addCard: async (card) => {
        if (isDemoActive()) {
          const row = {
            id: card.id || localId(),
            name: card.name,
            bank: card.bank || '',
            cutoffDay: Number(card.cutoffDay),
            dueDay: Number(card.dueDay),
            color: card.color || '#bec2ff',
            openingBalance: Number(card.openingBalance) || 0,
            paidCycles: card.paidCycles || [],
            payments: card.payments || [],
            cashbackRules: Array.isArray(card.cashbackRules) ? card.cashbackRules : [],
            catalogId: card.catalogId || null,
            createdAt: card.createdAt || new Date().toISOString(),
          };
          set((state) => ({ cards: [...state.cards, row] }));
          return row;
        }

        const user = await getCurrentUser();
        if (!user) return;

        const payload = {
          user_id: user.id,
          name: card.name,
          bank: card.bank || null,
          cutoff_day: Number(card.cutoffDay),
          due_day: Number(card.dueDay),
          color: card.color || '#6366f1',
          opening_balance: Number(card.openingBalance) || 0,
          cashback_rules: Array.isArray(card.cashbackRules) ? card.cashbackRules : [],
          catalog_id: card.catalogId || null,
        };

        const { data, error } = await supabase.from('credit_cards').insert(payload).select().single();
        if (error) {
          if (import.meta.env.DEV) console.error('Card insert error:', error);
          toast.error(tr('stores.cards.saveError'));
          return;
        }
        set((state) => ({ cards: [...state.cards, mapFromDb(data)] }));
        toast.success(tr('stores.cards.saved'));
      },

      updateCard: async (id, updates) => {
        if (isDemoActive()) {
          set((state) => ({ cards: state.cards.map((c) => (c.id === id ? { ...c, ...updates } : c)) }));
          return;
        }

        const dbUpdates = {};
        if (updates.name !== undefined) dbUpdates.name = updates.name;
        if (updates.bank !== undefined) dbUpdates.bank = updates.bank || null;
        if (updates.cutoffDay !== undefined) dbUpdates.cutoff_day = Number(updates.cutoffDay);
        if (updates.dueDay !== undefined) dbUpdates.due_day = Number(updates.dueDay);
        if (updates.color !== undefined) dbUpdates.color = updates.color;
        if (updates.openingBalance !== undefined) dbUpdates.opening_balance = Number(updates.openingBalance) || 0;
        if (updates.cashbackRules !== undefined) dbUpdates.cashback_rules = updates.cashbackRules;
        if (updates.catalogId !== undefined) dbUpdates.catalog_id = updates.catalogId || null;

        const { error } = await supabase.from('credit_cards').update(dbUpdates).eq('id', id);
        if (error) {
          if (import.meta.env.DEV) console.error('Card update error:', error);
          toast.error(tr('stores.cards.updateError'));
          return;
        }
        set((state) => ({
          cards: state.cards.map((c) => (c.id === id ? { ...c, ...updates } : c)),
        }));
        toast.success(tr('stores.cards.updated'));
      },

      deleteCard: async (id) => {
        if (isDemoActive()) {
          set((state) => ({ cards: state.cards.filter((c) => c.id !== id) }));
          return;
        }

        const { error } = await supabase.from('credit_cards').delete().eq('id', id);
        if (!error) {
          set((state) => ({ cards: state.cards.filter((c) => c.id !== id) }));
        }
      },

      // Un abono LIQUIDA el saldo de la tarjeta; nunca es un gasto del presupuesto
      // (el gasto ya se contó al registrar cada consumo). Se guarda en `payments`.
      addCardPayment: async (cardId, { amount, date, note, savingsUsed = [] } = {}) => {
        const card = get().cards.find((c) => c.id === cardId);
        if (!card) return;
        const value = Number(amount) || 0;
        if (value <= 0) return;

        const entry = {
          id: (globalThis.crypto?.randomUUID?.() || `p-${Date.now()}-${Math.random().toString(36).slice(2)}`),
          amount: value,
          date: date || todayISO(),
          note: note || '',
          savingsUsed,
        };
        const newPayments = [...(card.payments || []), entry];

        if (!isDemoActive()) {
          const { error } = await supabase.from('credit_cards').update({ payments: newPayments }).eq('id', cardId);
          if (error) {
            if (import.meta.env.DEV) console.error('Add card payment error:', error);
            toast.error(tr('stores.cards.paymentError'));
            return;
          }
        }
        set((state) => ({
          cards: state.cards.map((c) => (c.id === cardId ? { ...c, payments: newPayments } : c)),
        }));
        toast.success(tr('stores.cards.paymentSaved'));
        return entry;
      },

      // Pago de tarjeta con cascada. Si savingsPick no es null, retira ese monto
      // del ahorro (aporte negativo → baja la meta y devuelve efectivo) y registra
      // el pago con savingsUsed. Vale igual en demo y con sesión: addContribution
      // y addCardPayment ya resuelven cada modo por dentro.
      addCardPaymentWithCascade: async (cardId, payload, savingsPick) => {
        const savingsUsed = [];
        if (savingsPick && savingsPick.amount > 0) {
          await useSavingsStore.getState().addContribution(savingsPick.goalId, -Math.abs(savingsPick.amount), payload.date, 'Retiro para pago de tarjeta');
          savingsUsed.push({ goalId: savingsPick.goalId, amount: Math.abs(savingsPick.amount) });
        }
        return get().addCardPayment(cardId, { ...payload, savingsUsed });
      },

      deleteCardPayment: async (cardId, paymentId) => {
        const card = get().cards.find((c) => c.id === cardId);
        if (!card) return;
        // Reversa de cascada: devuelve a la meta lo que este pago tomó del ahorro.
        const entry = (card.payments || []).find((p) => p.id === paymentId);
        for (const s of (entry?.savingsUsed || [])) {
          await useSavingsStore.getState().addContribution(s.goalId, Math.abs(s.amount), entry.date, 'Reversa de retiro por pago');
        }
        const newPayments = (card.payments || []).filter((p) => p.id !== paymentId);

        if (!isDemoActive()) {
          const { error } = await supabase.from('credit_cards').update({ payments: newPayments }).eq('id', cardId);
          if (error) {
            if (import.meta.env.DEV) console.error('Delete card payment error:', error);
            toast.error(tr('stores.cards.paymentDeleteError'));
            return;
          }
        }
        set((state) => ({
          cards: state.cards.map((c) => (c.id === cardId ? { ...c, payments: newPayments } : c)),
        }));
        toast.success(tr('stores.cards.paymentDeleted'));
      },
    }),
    {
      name: 'fintrack-cards-cache',
  storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ cards: state.cards }),
    }
  )
);

export default useCreditCardStore;
