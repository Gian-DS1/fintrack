import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supabase, getCurrentUser } from '../lib/supabase';
import { findDuplicateCategories } from '../data/defaultCategories';
import { isDemoActive } from '../stitch/demoFlag';
import { generateId } from '../utils/id';

// Id local para las filas creadas en modo demo (no hay Postgres que lo genere).
const localId = () => generateId('demo-');

// Orden alfabético estable, el mismo que usan addCategory y restoreCategory.
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' });

// Shared across all calls: dedupes concurrent fetchCategories invocations so the
// seeding logic can never run twice in parallel.
let fetchInFlight = null;

const useCategoryStore = create(
  persist(
    (set, get) => ({
  categories: [],
  loading: false,
  error: null,

  fetchCategories: async () => {
    if (isDemoActive()) return; // demo: los datos los siembra demoMode
    if (fetchInFlight) return fetchInFlight;
    fetchInFlight = (async () => {
    set({ loading: true, error: null });
    const user = await getCurrentUser();
    if (!user) {
      set({ categories: [], loading: false });
      return;
    }

    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('user_id', user.id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      if (import.meta.env.DEV) console.error("Error fetching categories:", error);
      // Los usuarios construyen sus propias categorías; el demo es la vitrina
      // con las 37 default. Sin seed aquí: si falla el fetch, array vacío.
      set({ categories: [], loading: false });
      return;
    }

    // Sin datos → el usuario aún no tiene categorías (estado inicial legítimo).
    if (!data || data.length === 0) {
      set({ categories: [], loading: false });
      return;
    }

    // ── Auto-clean duplicates already in the database ───────────
    const { remap, deleteIds } = findDuplicateCategories(data);
    if (deleteIds.length > 0) {
      try {
        for (const { fromId, toId } of remap) {
          await supabase.from('transactions').update({ category_id: toId }).eq('user_id', user.id).eq('category_id', fromId);
          await supabase.from('budgets').update({ category_id: toId }).eq('user_id', user.id).eq('category_id', fromId);
        }
        await supabase.from('categories').delete().in('id', deleteIds);
      } catch (err) {
        if (import.meta.env.DEV) console.error('Auto-dedupe error:', err);
      }
    }

    // After cleaning, work only with the de-duplicated list.
    const cleanData = data.filter((c) => !deleteIds.includes(c.id));

    // Los usuarios construyen sus propias categorías; ya no se re-siembran las
    // "faltantes" del set por defecto. cleanData es la lista final.
    const formattedData = cleanData.map(c => ({
      ...c,
      isActive: c.is_active,
      sortOrder: c.sort_order,
      isAccumulative: c.is_accumulative || false,
      accumulationStart: c.accumulation_start || null
    }));
    set({ categories: formattedData.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' })), loading: false });
    })();

    try {
      await fetchInFlight;
    } finally {
      fetchInFlight = null;
    }
  },

  addCategory: async (category) => {
    const demo = isDemoActive();
    const user = demo ? null : await getCurrentUser();
    if (!demo && !user) return;

    if (demo) {
      const newCat = {
        id: category.id || localId(),
        name: category.name,
        type: category.type,
        icon: category.icon,
        color: category.color,
        slug: category.slug || null,
        keywords: category.keywords || [],
        isActive: category.isActive !== undefined ? category.isActive : true,
        sortOrder: get().categories.length,
        createdAt: new Date().toISOString(),
      };
      set((state) => ({ categories: [...state.categories, newCat].sort(byName) }));
      return;
    }

    const dbCategory = {
      user_id: user.id,
      name: category.name,
      type: category.type,
      icon: category.icon,
      color: category.color,
      keywords: category.keywords || [],
      is_active: category.isActive !== undefined ? category.isActive : true,
      sort_order: get().categories.length
    };

    const { data, error } = await supabase.from('categories').insert(dbCategory).select().single();
    if (!error && data) {
      const newCat = { ...data, isActive: data.is_active, sortOrder: data.sort_order };
      set((state) => ({
        categories: [...state.categories, newCat].sort((a, b) =>
          (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' })
        ),
      }));
    }
  },

  // Crea (si no existe) una categoría a partir de una definición
  // {slug, name, type, icon, color, keywords} y devuelve su id. Si ya existe (por
  // slug o nombre+tipo) devuelve el id existente sin duplicar. Al crear una
  // categoría de ecosistema, quita sus keywords del Supermercado del usuario para
  // que el auto-categorizador rutee la compra a la categoría dedicada.
  ensureCategory: async (def) => {
    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

    const found = get().categories.find(
      (c) => (def.slug && c.slug === def.slug) || (norm(c.name) === norm(def.name) && c.type === def.type)
    );
    if (found) return found.id;

    const demo = isDemoActive();
    const user = demo ? null : await getCurrentUser();
    if (!demo && !user) return null;

    let newCat;
    if (demo) {
      newCat = {
        id: localId(),
        name: def.name,
        type: def.type,
        icon: def.icon,
        color: def.color,
        slug: def.slug || null,
        keywords: def.keywords || [],
        isActive: true,
        sortOrder: get().categories.length,
        createdAt: new Date().toISOString(),
      };
    } else {
      const payload = {
        user_id: user.id,
        name: def.name,
        type: def.type,
        icon: def.icon,
        color: def.color,
        slug: def.slug || null,
        keywords: def.keywords || [],
        is_active: true,
        sort_order: get().categories.length,
      };

      const { data, error } = await supabase.from('categories').insert(payload).select().single();
      if (error || !data) {
        if (import.meta.env.DEV) console.error('ensureCategory error:', error);
        return null;
      }
      newCat = { ...data, isActive: data.is_active, sortOrder: data.sort_order };
    }

    set((state) => ({ categories: [...state.categories, newCat].sort(byName) }));

    // Quitar del Supermercado del usuario las keywords que ahora pertenecen a esta
    // categoría dedicada (solo afecta a usuarios cuyo Supermercado aún las tenga).
    const ecoKeys = new Set((def.keywords || []).map(norm));
    const sup = get().categories.find(
      (c) => c.slug === 'supermercado' || (norm(c.name) === 'supermercado' && c.type === 'variable_expense')
    );
    if (sup && Array.isArray(sup.keywords)) {
      const filtered = sup.keywords.filter((k) => !ecoKeys.has(norm(k)));
      if (filtered.length !== sup.keywords.length) {
        await get().updateCategory(sup.id, { keywords: filtered });
      }
    }

    return newCat.id;
  },

  updateCategory: async (id, updates) => {
    const dbUpdates = { ...updates };
    if (updates.isActive !== undefined) {
      dbUpdates.is_active = updates.isActive;
      delete dbUpdates.isActive;
    }
    if (updates.sortOrder !== undefined) {
      dbUpdates.sort_order = updates.sortOrder;
      delete dbUpdates.sortOrder;
    }
    if (updates.isAccumulative !== undefined) {
      dbUpdates.is_accumulative = updates.isAccumulative;
      delete dbUpdates.isAccumulative;
    }
    if (updates.accumulationStart !== undefined) {
      dbUpdates.accumulation_start = updates.accumulationStart;
      delete dbUpdates.accumulationStart;
    }

    if (isDemoActive()) {
      set((state) => ({
        categories: state.categories.map((c) => (c.id === id ? { ...c, ...updates } : c)),
      }));
      return;
    }

    const { error } = await supabase.from('categories').update(dbUpdates).eq('id', id);
    if (!error) {
      set((state) => ({
        categories: state.categories.map((c) => (c.id === id ? { ...c, ...updates } : c)),
      }));
    }
  },

  deleteCategory: async (id) => {
    if (isDemoActive()) {
      set((state) => ({ categories: state.categories.filter((c) => c.id !== id) }));
      return;
    }

    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (!error) {
      set((state) => ({ categories: state.categories.filter((c) => c.id !== id) }));
    }
  },

  restoreCategory: async (category) => {
    const demo = isDemoActive();
    const user = demo ? null : await getCurrentUser();
    if (!demo && !user) return;

    if (demo) {
      // Reinserta con su id original: el Deshacer devuelve la misma categoría.
      set((state) => ({ categories: [...state.categories, category].sort(byName) }));
      return;
    }

    const dbCategory = {
      id: category.id, user_id: user.id, name: category.name, type: category.type,
      icon: category.icon, color: category.color, slug: category.slug || null,
      keywords: category.keywords || [], is_active: category.isActive !== false,
      sort_order: category.sortOrder ?? 0,
    };
    const { data, error } = await supabase.from('categories').insert(dbCategory).select().single();
    if (!error && data) {
      const newCat = { ...data, isActive: data.is_active, sortOrder: data.sort_order };
      set((state) => ({
        categories: [...state.categories, newCat].sort((a, b) =>
          (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' })),
      }));
    }
  },

  toggleCategory: async (id) => {
    const cat = get().categories.find(c => c.id === id);
    if (!cat) return;
    await get().updateCategory(id, { isActive: !cat.isActive });
  },

  getActiveCategories: () => get().categories.filter((c) => c.isActive),
  getCategoriesByType: (type) => get().categories.filter((c) => c.type === type && c.isActive),
  getCategoryById: (id) => get().categories.find((c) => c.id === id),
}),
{
  name: 'fintrack-categories-cache',
  storage: createJSONStorage(() => sessionStorage),
  partialize: (state) => ({ categories: state.categories }),
}
)
);

export default useCategoryStore;
