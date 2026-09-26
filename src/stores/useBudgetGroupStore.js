// FinTrack — Grupos de presupuesto (varias categorías vistas como un total).
// Ejemplo: Bravo + Grupo CCN + Supermercado agrupados como "Supermercados".
// Persistencia: tabla budget_groups en Supabase + caché local (persist en
// sessionStorage, igual que los demás stores). En modo demo (sin sesión) las
// mutaciones aplican solo al estado local.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supabase, getCurrentUser } from '../lib/supabase';
import toast from 'react-hot-toast';
import { isDemoActive } from '../stitch/demoFlag';
import { tr } from '../i18n/runtime';
import { generateId } from '../utils/id';

const demoId = () => generateId('demo-');

const fromDb = (g) => ({
  id: g.id,
  name: g.name,
  icon: g.icon || null,
  categoryIds: Array.isArray(g.category_ids) ? g.category_ids : [],
  createdAt: g.created_at,
});

const useBudgetGroupStore = create(
  persist(
    (set, get) => ({
      groups: [],
      loading: false,

      fetchGroups: async () => {
        if (isDemoActive()) return; // demo: solo estado local
        set({ loading: true });
        const user = await getCurrentUser();
        if (!user) return set({ groups: [], loading: false });

        const { data, error } = await supabase
          .from('budget_groups')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: true });
        if (!error && data) {
          set({ groups: data.map(fromDb), loading: false });
        } else {
          // Tabla ausente (falta migración) u otro error: degrada a lista vacía
          // sin romper la pestaña de Presupuesto.
          if (import.meta.env.DEV) console.error('Error fetching budget groups:', error);
          set({ loading: false });
        }
      },

      addGroup: async ({ name, icon = null, categoryIds = [] }) => {
        const clean = { name: (name || '').trim(), icon, categoryIds };
        if (!clean.name || clean.categoryIds.length === 0) return false;

        if (isDemoActive()) {
          const row = { id: demoId(), ...clean, createdAt: new Date().toISOString() };
          set((s) => ({ groups: [...s.groups, row] }));
          return true;
        }

        const user = await getCurrentUser();
        if (!user) return false;

        const { data, error } = await supabase
          .from('budget_groups')
          .insert({ user_id: user.id, name: clean.name, icon: clean.icon, category_ids: clean.categoryIds })
          .select()
          .single();
        if (error || !data) {
          if (import.meta.env.DEV) console.error('Error creating budget group:', error);
          toast.error(tr('stores.budgetGroups.createError'));
          return false;
        }
        set((s) => ({ groups: [...s.groups, fromDb(data)] }));
        return true;
      },

      updateGroup: async (id, { name, icon, categoryIds }) => {
        const prev = get().groups;
        const updates = {};
        if (name !== undefined) updates.name = (name || '').trim();
        if (icon !== undefined) updates.icon = icon;
        if (categoryIds !== undefined) updates.categoryIds = categoryIds;

        // Optimista: refleja el cambio y hace rollback si Supabase falla.
        set((s) => ({ groups: s.groups.map((g) => (g.id === id ? { ...g, ...updates } : g)) }));
        if (isDemoActive()) return true;

        const dbUpdates = {};
        if (updates.name !== undefined) dbUpdates.name = updates.name;
        if (updates.icon !== undefined) dbUpdates.icon = updates.icon;
        if (updates.categoryIds !== undefined) dbUpdates.category_ids = updates.categoryIds;

        const { error } = await supabase.from('budget_groups').update(dbUpdates).eq('id', id);
        if (error) {
          if (import.meta.env.DEV) console.error('Error updating budget group:', error);
          toast.error(tr('stores.budgetGroups.saveError'));
          set({ groups: prev });
          return false;
        }
        return true;
      },

      deleteGroup: async (id) => {
        const prev = get().groups;
        set((s) => ({ groups: s.groups.filter((g) => g.id !== id) }));
        if (isDemoActive()) return true;

        const { error } = await supabase.from('budget_groups').delete().eq('id', id);
        if (error) {
          if (import.meta.env.DEV) console.error('Error deleting budget group:', error);
          toast.error(tr('stores.budgetGroups.deleteError'));
          set({ groups: prev });
          return false;
        }
        return true;
      },
    }),
    {
      name: 'fintrack-budget-groups-cache',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ groups: state.groups }),
    },
  ),
);

export default useBudgetGroupStore;
