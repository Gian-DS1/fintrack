// FinTrack — Transacciones recurrentes (plantillas)
//
// Una plantilla describe una transacción que se repite (semanal/quincenal/
// mensual). Al abrir la app, `materializeDue` crea las transacciones reales de
// las ocurrencias vencidas (recuperando las que se saltaron) y avanza `nextDate`.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supabase, getCurrentUser } from '../lib/supabase';
import toast from 'react-hot-toast';
import { todayISO } from '../utils/formatters';
import { advanceDate } from '../utils/recurrence';
import useTransactionStore from './useTransactionStore';
import { getCurrency } from '../utils/currencyRuntime';
import { tr } from '../i18n/runtime';

// Re-export para que los consumidores que ya lo importan desde aquí sigan funcionando.
export { advanceDate };

// Dedupe de llamadas concurrentes a materializeDue (StrictMode, doble montaje)
// para no crear transacciones duplicadas.
let materializeInFlight = null;

const mapFromDb = (r) => ({
  id: r.id,
  categoryId: r.category_id,
  cardId: r.card_id || null,
  amount: Number(r.amount),
  type: r.type,
  description: r.description,
  notes: r.notes,
  currency: r.currency || 'DOP',
  frequency: r.frequency,
  nextDate: r.next_date,
  active: r.active,
  createdAt: r.created_at,
});

const useRecurringStore = create(
  persist(
    (set, get) => ({
      recurring: [],
      loading: false,

      fetchRecurring: async () => {
        set({ loading: true });
        const user = await getCurrentUser();
        if (!user) return set({ recurring: [], loading: false });

        const { data, error } = await supabase
          .from('recurring_transactions')
          .select('*')
          .eq('user_id', user.id)
          .order('next_date', { ascending: true });

        if (!error && data) {
          set({ recurring: data.map(mapFromDb), loading: false });
        } else {
          if (import.meta.env.DEV) console.error('Error fetching recurring:', error);
          set({ loading: false });
        }
      },

      addRecurring: async (t) => {
        const user = await getCurrentUser();
        if (!user) return;

        const payload = {
          user_id: user.id,
          category_id: t.categoryId || null,
          card_id: t.cardId || null,
          amount: Number(t.amount),
          type: t.type,
          description: t.description || null,
          notes: t.notes || null,
          currency: t.currency || 'DOP',
          frequency: t.frequency || 'monthly',
          next_date: t.nextDate,
          active: true,
        };

        const { data, error } = await supabase
          .from('recurring_transactions')
          .insert(payload)
          .select()
          .single();
        if (error) {
          if (import.meta.env.DEV) console.error('Recurring insert error:', error);
          toast.error(tr('stores.recurring.createError'));
          return;
        }
        set((state) => ({ recurring: [...state.recurring, mapFromDb(data)] }));
      },

      toggleActive: async (id) => {
        const r = get().recurring.find((x) => x.id === id);
        if (!r) return;
        const { error } = await supabase
          .from('recurring_transactions')
          .update({ active: !r.active })
          .eq('id', id);
        if (!error) {
          set((state) => ({
            recurring: state.recurring.map((x) => (x.id === id ? { ...x, active: !x.active } : x)),
          }));
        }
      },

      deleteRecurring: async (id) => {
        const { error } = await supabase.from('recurring_transactions').delete().eq('id', id);
        if (!error) {
          set((state) => ({ recurring: state.recurring.filter((x) => x.id !== id) }));
        }
      },

      // Materializa todas las ocurrencias vencidas (<= hoy) de las plantillas
      // activas como transacciones reales. Devuelve { count, created }.
      materializeDue: async () => {
        if (materializeInFlight) return materializeInFlight;
        materializeInFlight = get()._materializeDue();
        try {
          return await materializeInFlight;
        } finally {
          materializeInFlight = null;
        }
      },

      _materializeDue: async () => {
        const today = todayISO();
        const due = get().recurring.filter((r) => r.active && r.nextDate <= today);
        if (due.length === 0) return { count: 0, created: [] };

        const toCreate = [];
        const advanced = []; // { id, nextDate }

        for (const t of due) {
          let next = t.nextDate;
          let guard = 0;
          while (next <= today && guard < 120) {
            toCreate.push({
              categoryId: t.categoryId,
              cardId: t.cardId || null,
              amount: Number(t.amount),
              type: t.type,
              description: t.description,
              date: next,
              notes: t.notes || 'Generado automáticamente (recurrente)',
              currency: getCurrency(),
            });
            next = advanceDate(next, t.frequency);
            guard++;
          }
          advanced.push({ id: t.id, nextDate: next });
        }

        if (toCreate.length === 0) return { count: 0, created: [] };

        // Insertar las transacciones (ya en DOP) en lote.
        await useTransactionStore.getState().bulkAddTransactions(toCreate);

        // Avanzar next_date de cada plantilla (en DB y en estado). Se avanza
        // siempre para no recrear duplicados en la próxima carga.
        for (const a of advanced) {
          await supabase.from('recurring_transactions').update({ next_date: a.nextDate }).eq('id', a.id);
        }
        set((state) => ({
          recurring: state.recurring.map((r) => {
            const a = advanced.find((x) => x.id === r.id);
            return a ? { ...r, nextDate: a.nextDate } : r;
          }),
        }));

        return { count: toCreate.length, created: toCreate.map((t) => t.description || 'Transacción') };
      },
    }),
    {
      name: 'fintrack-recurring-cache',
  storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ recurring: state.recurring }),
    }
  )
);

export default useRecurringStore;
