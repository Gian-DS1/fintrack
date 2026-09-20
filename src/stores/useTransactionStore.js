import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supabase, getCurrentUser } from '../lib/supabase';
import toast from 'react-hot-toast';
import useCreditCardStore from './useCreditCardStore';
import { computeCashback } from '../utils/creditCards';
import { getCurrency } from '../utils/currencyRuntime';
import { tr } from '../i18n/runtime';
import { isDemoActive } from '../stitch/demoFlag';

// Id local para las filas creadas en modo demo (no hay Postgres que lo genere).
const localId = () =>
  (globalThis.crypto?.randomUUID?.() || `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`);

// El cashback aplica a CUALQUIER tipo de gasto (fijo o variable), no solo al
// tipo genérico 'expense'. Misma regla que el formulario de transacciones.
const earnsCashback = (type) => type === 'expense' || type === 'fixed_expense' || type === 'variable_expense';

const useTransactionStore = create(
  persist(
    (set, get) => ({
  transactions: [],
  loading: false,

  fetchTransactions: async () => {
    if (isDemoActive()) return; // demo: los datos los siembra demoMode
    set({ loading: true });
    const user = await getCurrentUser();
    if (!user) {
      set({ transactions: [], loading: false });
      return;
    }

    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (!error && data) {
      const formattedData = data.map(t => ({
        ...t,
        categoryId: t.category_id,
        cardId: t.card_id || null,
        cashbackEarned: t.cashback_earned ? Number(t.cashback_earned) : 0,
        createdAt: t.created_at
      }));
      set({ transactions: formattedData, loading: false });
    } else {
      if (import.meta.env.DEV) console.error('Error fetching transactions:', error);
      toast.error(tr('stores.transactions.loadError'));
      set({ loading: false });
    }
  },

  addTransaction: async (transaction) => {
    const demo = isDemoActive();
    const user = demo ? null : await getCurrentUser();
    if (!demo && !user) return;

    let amount = Number(transaction.amount);
    let notes = transaction.notes || null;

    // Cashback se calcula sobre el monto ya en la moneda base y solo para gastos.
    let cashbackEarned = 0;
    if (transaction.cardId && earnsCashback(transaction.type)) {
      const card = useCreditCardStore.getState().cards.find((c) => c.id === transaction.cardId);
      cashbackEarned = computeCashback(card, transaction.categoryId, amount);
    }

    if (demo) {
      const row = {
        id: localId(),
        categoryId: transaction.categoryId || '',
        cardId: transaction.cardId || null,
        amount,
        type: transaction.type,
        description: transaction.description || '',
        date: transaction.date,
        notes,
        currency: transaction.currency || getCurrency(),
        cashbackEarned,
        createdAt: new Date().toISOString(),
      };
      set((state) => ({ transactions: [row, ...state.transactions] }));
      toast.success(tr('stores.transactions.saved'));
      return row.id;
    }

    const dbTx = {
      user_id: user.id,
      category_id: transaction.categoryId || null,
      card_id: transaction.cardId || null,
      amount: amount,
      type: transaction.type,
      description: transaction.description,
      date: transaction.date,
      notes: notes,
      currency: getCurrency(),
      cashback_earned: cashbackEarned
    };

    const { data, error } = await supabase.from('transactions').insert(dbTx).select().single();
    if (error) {
      if (import.meta.env.DEV) console.error("Transaction insert error:", error);
      toast.error(tr('stores.transactions.saveError') + error.message);
      return null;
    }

    if (data) {
      const newTx = {
        ...data,
        categoryId: data.category_id,
        cardId: data.card_id || null,
        cashbackEarned: data.cashback_earned ? Number(data.cashback_earned) : 0,
        createdAt: data.created_at
      };
      set((state) => ({ transactions: [newTx, ...state.transactions] }));
      toast.success(tr('stores.transactions.saved'));
      // Devuelve el id de la fila creada para que quien la origina (p. ej. un
      // pago de deuda) pueda enlazarla y revertirla luego.
      return data.id;
    }
    return null;
  },

  // Borra una transacción por id sin toast ni confirmación (uso interno: revertir
  // un pago de deuda enlazado). Devuelve true/false.
  deleteTransactionSilent: async (id) => {
    if (!id) return false;
    if (isDemoActive()) {
      set((state) => ({ transactions: state.transactions.filter((t) => t.id !== id) }));
      return true;
    }
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) {
      if (import.meta.env.DEV) console.error('Silent transaction delete error:', error);
      return false;
    }
    set((state) => ({ transactions: state.transactions.filter((t) => t.id !== id) }));
    return true;
  },

  updateTransaction: async (id, updates) => {
    // Whitelist only real DB columns. The edit form carries extra fields
    // (id, createdAt, currency, isRecurring, ...) that would make Supabase
    // reject the update with an "unknown column" error.
    const dbUpdates = {};
    if (updates.categoryId !== undefined) dbUpdates.category_id = updates.categoryId || null;
    if (updates.cardId !== undefined) dbUpdates.card_id = updates.cardId || null;
    if (updates.amount !== undefined) dbUpdates.amount = Number(updates.amount);
    if (updates.type !== undefined) dbUpdates.type = updates.type;
    if (updates.description !== undefined) dbUpdates.description = updates.description;
    if (updates.date !== undefined) dbUpdates.date = updates.date;
    if (updates.notes !== undefined) dbUpdates.notes = updates.notes || null;
    if (updates.cashbackEarned !== undefined) dbUpdates.cashback_earned = Number(updates.cashbackEarned);

    if (!isDemoActive()) {
      const { error } = await supabase.from('transactions').update(dbUpdates).eq('id', id);
      if (error) {
        if (import.meta.env.DEV) console.error('Transaction update error:', error);
        toast.error(tr('stores.transactions.updateError') + error.message);
        return;
      }
    }

    set((state) => ({
      transactions: state.transactions.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      ),
    }));
    toast.success(tr('stores.transactions.updated'));
  },

  deleteTransaction: async (id) => {
    if (!isDemoActive()) {
      const { error } = await supabase.from('transactions').delete().eq('id', id);
      if (error) {
        if (import.meta.env.DEV) console.error('Transaction delete error:', error);
        toast.error(tr('stores.transactions.deleteError') + error.message);
        return false;
      }
    }
    set((state) => ({
      transactions: state.transactions.filter((t) => t.id !== id),
    }));
    return true;
  },

  // Re-inserta una transacción borrada (para "Deshacer"). Preserva los valores
  // ya procesados (monto en DOP, cashback) sin re-convertir ni recalcular, así
  // que restaurar devuelve exactamente lo que se eliminó. El id cambia (fila
  // nueva), lo cual es seguro: nada referencia una transacción por id.
  restoreTransaction: async (tx) => {
    const demo = isDemoActive();
    const user = demo ? null : await getCurrentUser();
    if (!demo && !user) return false;

    if (demo) {
      // En demo se reinserta con su id original (no hay Postgres que asigne uno).
      set((state) => ({ transactions: [tx, ...state.transactions] }));
      return true;
    }

    const dbTx = {
      user_id: user.id,
      category_id: tx.categoryId || null,
      card_id: tx.cardId || null,
      amount: Number(tx.amount),
      type: tx.type,
      description: tx.description,
      date: tx.date,
      notes: tx.notes || null,
      currency: tx.currency || getCurrency(),
      cashback_earned: Number(tx.cashbackEarned) || 0,
    };

    const { data, error } = await supabase.from('transactions').insert(dbTx).select().single();
    if (error) {
      if (import.meta.env.DEV) console.error('Transaction restore error:', error);
      toast.error(tr('stores.transactions.restoreError'));
      return false;
    }
    if (data) {
      const newTx = {
        ...data,
        categoryId: data.category_id,
        cardId: data.card_id || null,
        cashbackEarned: data.cashback_earned ? Number(data.cashback_earned) : 0,
        createdAt: data.created_at,
      };
      set((state) => ({ transactions: [newTx, ...state.transactions] }));
    }
    return true;
  },

  bulkDeleteTransactions: async (ids) => {
    if (!ids || ids.length === 0) return [];
    // Capturamos las filas antes de borrarlas para poder ofrecer "Deshacer".
    const removed = get().transactions.filter((t) => ids.includes(t.id));
    if (!isDemoActive()) {
      const { error } = await supabase.from('transactions').delete().in('id', ids);
      if (error) {
        if (import.meta.env.DEV) console.error('Bulk delete error:', error);
        toast.error(tr('stores.transactions.bulkDeleteError'));
        return [];
      }
    }
    set((state) => ({
      transactions: state.transactions.filter((t) => !ids.includes(t.id)),
    }));
    return removed;
  },

  // Re-inserta varias transacciones borradas (para "Deshacer" en bloque).
  restoreManyTransactions: async (txs) => {
    if (!txs || txs.length === 0) return false;
    const demo = isDemoActive();
    const user = demo ? null : await getCurrentUser();
    if (!demo && !user) return false;

    if (demo) {
      // Reinserta con sus ids originales, igual que restoreTransaction.
      set((state) => ({ transactions: [...txs, ...state.transactions] }));
      return true;
    }

    const dbTxs = txs.map((tx) => ({
      user_id: user.id,
      category_id: tx.categoryId || null,
      card_id: tx.cardId || null,
      amount: Number(tx.amount),
      type: tx.type,
      description: tx.description,
      date: tx.date,
      notes: tx.notes || null,
      currency: tx.currency || getCurrency(),
      cashback_earned: Number(tx.cashbackEarned) || 0,
    }));

    const { data, error } = await supabase.from('transactions').insert(dbTxs).select();
    if (error) {
      if (import.meta.env.DEV) console.error('Bulk restore error:', error);
      toast.error(tr('stores.transactions.bulkRestoreError'));
      return false;
    }
    if (data) {
      const newTxs = data.map((d) => ({
        ...d,
        categoryId: d.category_id,
        cardId: d.card_id || null,
        cashbackEarned: d.cashback_earned ? Number(d.cashback_earned) : 0,
        createdAt: d.created_at,
      }));
      set((state) => ({ transactions: [...newTxs, ...state.transactions] }));
    }
    return true;
  },

  bulkAssignCard: async (ids, cardId) => {
    if (!ids || ids.length === 0) return;
    const dbCardId = cardId || null;
    
    const cards = useCreditCardStore.getState().cards;
    const card = dbCardId ? cards.find(c => c.id === dbCardId) : null;
    
    const transactionsToUpdate = get().transactions.filter(t => ids.includes(t.id));
    toast.loading(tr('stores.transactions.assigningCard'), { id: 'bulk-update' });
    
    // Cashback solo para gastos; el monto ya está en DOP. El cálculo es el
    // mismo en ambos modos; en demo solo se salta el viaje a Supabase.
    const cashbackFor = (t) => ((card && earnsCashback(t.type))
      ? computeCashback(card, t.categoryId, t.amount)
      : 0);

    const results = isDemoActive()
      ? transactionsToUpdate.map((t) => ({ id: t.id, error: null, cashback: cashbackFor(t) }))
      : await Promise.all(transactionsToUpdate.map((t) => {
        const cashback = cashbackFor(t);
        return supabase.from('transactions').update({
          card_id: dbCardId,
          cashback_earned: cashback
        }).eq('id', t.id).then(({ error }) => ({ id: t.id, error, cashback }));
      }));
    const hasError = results.some(r => r.error);
    
    if (hasError) {
      if (import.meta.env.DEV) console.error('Bulk update error', results);
      toast.error(tr('stores.transactions.bulkUpdateError'), { id: 'bulk-update' });
    } else {
      toast.success(tr('stores.transactions.bulkUpdated'), { id: 'bulk-update' });
    }
    
    set((state) => ({
      transactions: state.transactions.map((t) => {
        if (ids.includes(t.id)) {
          const result = results.find(r => r.id === t.id);
          if (!result || result.error) return t;
          return { ...t, cardId: dbCardId, cashbackEarned: result.cashback };
        }
        return t;
      }),
    }));
  },

  // Cambia la categoría de varias transacciones a la vez. Recalcula el cashback
  // de cada una según la nueva categoría y la tarjeta que ya tuviera asignada.
  bulkAssignCategory: async (ids, categoryId) => {
    if (!ids || ids.length === 0) return;
    const dbCategoryId = categoryId || null;
    const cards = useCreditCardStore.getState().cards;
    const transactionsToUpdate = get().transactions.filter((t) => ids.includes(t.id));
    toast.loading(tr('stores.transactions.assigningCategory'), { id: 'bulk-update' });
    const cashbackFor = (t) => {
      const card = t.cardId ? cards.find((c) => c.id === t.cardId) : null;
      return (card && earnsCashback(t.type))
        ? computeCashback(card, dbCategoryId, t.amount) : 0;
    };

    const results = isDemoActive()
      ? transactionsToUpdate.map((t) => ({ id: t.id, error: null, cashback: cashbackFor(t) }))
      : await Promise.all(transactionsToUpdate.map((t) => supabase.from('transactions').update({
        category_id: dbCategoryId, cashback_earned: cashbackFor(t),
      }).eq('id', t.id).then(({ error }) => ({ id: t.id, error, cashback: cashbackFor(t) }))));
    if (results.some((r) => r.error)) {
      toast.error(tr('stores.transactions.bulkUpdateError'), { id: 'bulk-update' });
    } else {
      toast.success(tr('stores.transactions.categoriesUpdated'), { id: 'bulk-update' });
    }
    set((state) => ({
      transactions: state.transactions.map((t) => {
        if (ids.includes(t.id)) {
          const result = results.find((r) => r.id === t.id);
          if (!result || result.error) return t;
          return { ...t, categoryId: dbCategoryId, cashbackEarned: result.cashback };
        }
        return t;
      }),
    }));
  },

  bulkAddTransactions: async (transactions) => {
    const demo = isDemoActive();
    const user = demo ? null : await getCurrentUser();
    if (!demo && !user) return 0;

    // Las filas pueden traer cardId (p. ej. recurrentes pagadas con tarjeta).
    // El monto ya viene en la moneda base; el cashback solo aplica a gastos con tarjeta.
    const cards = useCreditCardStore.getState().cards;
    const dbTxs = transactions.map(t => {
      const cardId = t.cardId || null;
      const card = cardId ? cards.find((c) => c.id === cardId) : null;
      const cashback = (card && earnsCashback(t.type))
        ? computeCashback(card, t.categoryId, t.amount)
        : 0;
      return {
        user_id: user?.id,
        category_id: t.categoryId || null,
        card_id: cardId,
        amount: t.amount,
        type: t.type,
        description: t.description,
        date: t.date,
        notes: t.notes || null,
        currency: getCurrency(),
        cashback_earned: cashback,
      };
    });

    if (demo) {
      const newTxs = dbTxs.map((d) => ({
        id: localId(),
        categoryId: d.category_id || '',
        cardId: d.card_id,
        amount: Number(d.amount),
        type: d.type,
        description: d.description,
        date: d.date,
        notes: d.notes,
        currency: d.currency,
        cashbackEarned: Number(d.cashback_earned) || 0,
        createdAt: new Date().toISOString(),
      }));
      set((state) => ({ transactions: [...newTxs, ...state.transactions] }));
      return newTxs.length;
    }

    // Insert in batches of 100 to avoid payload limits
    const batchSize = 100;
    let allInserted = [];
    let hasError = false;

    for (let i = 0; i < dbTxs.length; i += batchSize) {
      const batch = dbTxs.slice(i, i + batchSize);
      const { data, error } = await supabase.from('transactions').insert(batch).select();
      if (error) {
        if (import.meta.env.DEV) console.error('Bulk insert error:', error);
        hasError = true;
        toast.error(tr('stores.transactions.importBatchError') + error.message);
        break;
      }
      if (data) {
        allInserted = [...allInserted, ...data];
      }
    }

    if (allInserted.length > 0) {
      const newTxs = allInserted.map(d => ({ ...d, categoryId: d.category_id, cardId: d.card_id || null, cashbackEarned: d.cashback_earned ? Number(d.cashback_earned) : 0, createdAt: d.created_at }));
      set((state) => ({ transactions: [...newTxs, ...state.transactions] }));
    }

    if (hasError && allInserted.length > 0) {
      toast.success(tr('stores.transactions.importedPartial').replace('{n}', allInserted.length));
    }

    return allInserted.length;
  },

  getTransactionsByMonth: (year, month) => {
    return get().transactions.filter((t) => {
      const date = new Date(t.date + 'T00:00:00');
      return date.getFullYear() === year && date.getMonth() === month;
    });
  },

  getTransactionsByDateRange: (startDate, endDate) => {
    return get().transactions.filter((t) => {
      return t.date >= startDate && t.date <= endDate;
    });
  },

  getTransactionsByCategory: (categoryId) => {
    return get().transactions.filter((t) => t.categoryId === categoryId);
  },

  getTransactionsByType: (type) => {
    return get().transactions.filter((t) => t.type === type);
  },
}),
{
  name: 'fintrack-transactions-cache',
  storage: createJSONStorage(() => sessionStorage),
  // Cachear solo las 500 transacciones más recientes (ya vienen ordenadas
  // desc por fecha) para no exceder el límite de ~5MB de localStorage en
  // usuarios con mucho historial. Supabase sigue siendo la fuente completa.
  partialize: (state) => ({ transactions: state.transactions.slice(0, 500) }),
}
)
);

export default useTransactionStore;
