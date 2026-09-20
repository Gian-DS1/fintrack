import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supabase, getCurrentUser } from '../lib/supabase';
import toast from 'react-hot-toast';
import { tr } from '../i18n/runtime';

const useBudgetStore = create(
  persist(
    (set, get) => ({
  budgets: [],
  loading: false,

  fetchBudgets: async () => {
    set({ loading: true });
    const user = await getCurrentUser();
    if (!user) return set({ budgets: [], loading: false });

    const { data, error } = await supabase.from('budgets').select('*').eq('user_id', user.id);
    if (!error && data) {
      const formatted = data.map(b => {
        const [y, m] = b.month.split('-');
        return {
          id: b.id,
          categoryId: b.category_id,
          year: parseInt(y, 10),
          month: parseInt(m, 10) - 1,
          estimatedAmount: Number(b.amount),
          createdAt: b.created_at
        };
      });
      set({ budgets: formatted, loading: false });
    } else {
      if (import.meta.env.DEV) console.error('Error fetching budgets:', error);
      toast.error(tr('stores.budgets.loadError'));
      set({ loading: false });
    }
  },

  setBudget: async (categoryId, year, month, estimatedAmount) => {
    // Get current budgets state for potential rollback
    const previousBudgets = [...get().budgets];

    // Optimistically update the state synchronously first
    const optimisticFormatted = {
      id: `temp-${categoryId}-${year}-${month}`,
      categoryId: categoryId,
      year: year,
      month: month,
      estimatedAmount: Number(estimatedAmount),
      createdAt: new Date().toISOString()
    };

    set((state) => {
      const existingIdx = state.budgets.findIndex(
        (b) => b.categoryId === categoryId && b.year === year && b.month === month
      );
      if (existingIdx >= 0) {
        const newB = [...state.budgets];
        newB[existingIdx] = {
          ...newB[existingIdx],
          estimatedAmount: Number(estimatedAmount)
        };
        return { budgets: newB };
      } else {
        return { budgets: [...state.budgets, optimisticFormatted] };
      }
    });

    try {
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("Usuario no autenticado");
      }

      const dbMonth = `${year}-${String(month + 1).padStart(2, '0')}`;
      const dbPayload = {
        user_id: user.id,
        category_id: categoryId,
        amount: Number(estimatedAmount),
        month: dbMonth
      };

      // Manual check to bypass database unique constraint missing errors on upsert
      const { data: existingData } = await supabase
        .from('budgets')
        .select('id')
        .eq('user_id', user.id)
        .eq('category_id', categoryId)
        .eq('month', dbMonth)
        .maybeSingle();

      let result;
      if (existingData) {
        result = await supabase
          .from('budgets')
          .update({ amount: Number(estimatedAmount) })
          .eq('id', existingData.id)
          .select()
          .single();
      } else {
        result = await supabase
          .from('budgets')
          .insert(dbPayload)
          .select()
          .single();
      }

      const { data, error } = result;
      
      if (!error && data) {
        const formatted = {
          id: data.id,
          categoryId: data.category_id,
          year: year,
          month: month,
          estimatedAmount: Number(data.amount),
          createdAt: data.created_at
        };
        
        // Update the state with the actual database-persisted record
        set((state) => {
          const existingIdx = state.budgets.findIndex(
            (b) => b.categoryId === categoryId && b.year === year && b.month === month
          );
          if (existingIdx >= 0) {
            const newB = [...state.budgets];
            newB[existingIdx] = formatted;
            return { budgets: newB };
          } else {
            return { budgets: [...state.budgets, formatted] };
          }
        });

        // Trigger a subtle success toast indicating the change has been successfully saved
        toast.success(tr('stores.budgets.saved'));
      } else {
        throw error || new Error("Error en la respuesta de Supabase");
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error("Budget save error:", error);
      // Rollback to previous state on failure
      set({ budgets: previousBudgets });
      toast.error(tr('stores.budgets.saveError'));
    }
  },

  // Aplica varios presupuestos de un mes de una sola vez (usado por el
  // auto-presupuesto sugerido). Inserta los nuevos en lote y actualiza los
  // existentes; sin toasts por ítem (el llamante muestra un resumen).
  // entries: [{ categoryId, amount }]. Devuelve cuántas categorías se aplicaron.
  bulkSetBudgets: async (year, month, entries) => {
    if (!entries || entries.length === 0) return 0;
    const user = await getCurrentUser();
    if (!user) return 0;

    const dbMonth = `${year}-${String(month + 1).padStart(2, '0')}`;
    const current = get().budgets;

    const toInsert = [];
    const toUpdate = []; // { id, categoryId, amount }
    for (const e of entries) {
      const amount = Number(e.amount) || 0;
      const existing = current.find(
        (b) => b.categoryId === e.categoryId && b.year === year && b.month === month
      );
      if (existing && !String(existing.id).startsWith('temp-')) {
        toUpdate.push({ id: existing.id, categoryId: e.categoryId, amount });
      } else {
        toInsert.push({ user_id: user.id, category_id: e.categoryId, amount, month: dbMonth });
      }
    }

    try {
      // Actualizaciones en paralelo.
      await Promise.all(
        toUpdate.map((u) => supabase.from('budgets').update({ amount: u.amount }).eq('id', u.id))
      );

      // Inserciones en lote.
      let insertedRows = [];
      if (toInsert.length > 0) {
        const { data, error } = await supabase.from('budgets').insert(toInsert).select();
        if (error) throw error;
        insertedRows = data || [];
      }

      // Reflejar en el estado local.
      set((state) => {
        let next = state.budgets.map((b) => {
          const u = toUpdate.find((x) => x.id === b.id);
          return u ? { ...b, estimatedAmount: u.amount } : b;
        });
        const formattedInserts = insertedRows.map((b) => {
          const [y, m] = b.month.split('-');
          return {
            id: b.id,
            categoryId: b.category_id,
            year: parseInt(y, 10),
            month: parseInt(m, 10) - 1,
            estimatedAmount: Number(b.amount),
            createdAt: b.created_at,
          };
        });
        return { budgets: [...next, ...formattedInserts] };
      });

      return toUpdate.length + toInsert.length;
    } catch (error) {
      if (import.meta.env.DEV) console.error('Bulk set budgets error:', error);
      toast.error(tr('stores.budgets.applySuggestedError'));
      return 0;
    }
  },

  getBudgetsByMonth: (year, month) => {
    return get().budgets.filter((b) => b.year === year && b.month === month);
  },

  deleteBudget: async (id) => {
    const { error } = await supabase.from('budgets').delete().eq('id', id);
    if (!error) {
      set((state) => ({ budgets: state.budgets.filter((b) => b.id !== id) }));
    }
  },

  copyBudgetFromPreviousMonth: async (year, month) => {
    let prevMonth = month - 1;
    let prevYear = year;
    if (prevMonth < 0) {
      prevMonth = 11;
      prevYear = year - 1;
    }

    const previousBudgets = get().budgets.filter(
      (b) => b.year === prevYear && b.month === prevMonth
    );

    if (previousBudgets.length === 0) return false;

    // PISA los montos del mes destino con los del anterior (e inserta los que
    // falten) vía bulkSetBudgets. Antes solo insertaba las categorías sin fila:
    // si ya existía una (p. ej. creada con 0 al tocar un sobre), conservaba su
    // monto viejo y "copiar mes anterior" no dejaba el mes igual al anterior.
    const entries = previousBudgets.map((pb) => ({
      categoryId: pb.categoryId,
      amount: pb.estimatedAmount,
    }));
    const applied = await get().bulkSetBudgets(year, month, entries);
    return applied > 0;
  },
}),
{
  name: 'fintrack-budgets-cache',
  storage: createJSONStorage(() => sessionStorage),
  partialize: (state) => ({ budgets: state.budgets }),
}
)
);

export default useBudgetStore;
