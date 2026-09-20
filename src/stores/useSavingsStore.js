import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supabase, getCurrentUser } from '../lib/supabase';
import toast from 'react-hot-toast';
import useCategoryStore from './useCategoryStore';
import useTransactionStore from './useTransactionStore';
import { getCurrency } from '../utils/currencyRuntime';
import { tr } from '../i18n/runtime';

// Resuelve una categoría de tipo ahorro para enlazar la transacción del aporte.
// Cae a '' si la cuenta no tiene una categoría savings (la tx sigue type:savings).
function savingsCategoryId() {
  const cats = useCategoryStore.getState().categories;
  const c = cats.find((x) => x.slug === 'ahorro') || cats.find((x) => x.type === 'savings');
  return c?.id || '';
}

const useSavingsStore = create(
  persist(
    (set, get) => ({
  goals: [],
  contributions: [],
  loading: false,

  fetchGoals: async () => {
    set({ loading: true });
    const user = await getCurrentUser();
    if (!user) return set({ goals: [], contributions: [], loading: false });

    const [goalsRes, contribRes] = await Promise.all([
      supabase.from('savings').select('*').eq('user_id', user.id),
      supabase.from('savings_contributions').select('*').eq('user_id', user.id),
    ]);

    if (goalsRes.error) {
      if (import.meta.env.DEV) console.error('Error fetching savings goals:', goalsRes.error);
      toast.error(tr('stores.savings.loadError'));
      return set({ loading: false });
    }

    const goals = goalsRes.data.map((g) => ({
      id: g.id,
      title: g.title,
      targetAmount: Number(g.target_amount),
      currentAmount: Number(g.current_amount),
      monthlyContribution: Number(g.monthly_contribution) || 0,
      deadline: g.deadline,
      icon: g.icon,
      color: g.color,
      status: g.status,
      currency: g.currency || 'DOP',
      horizon: g.horizon || null,
      createdAt: g.created_at,
    }));

    // savings_contributions puede no existir aún (migración a mano). Degrada a [].
    const contributions = (!contribRes.error && contribRes.data)
      ? contribRes.data.map((c) => ({
          id: c.id,
          goalId: c.goal_id,
          amount: Number(c.amount),
          date: c.date,
          notes: c.notes,
          transactionId: c.transaction_id || null,
          createdAt: c.created_at,
        }))
      : [];

    set({ goals, contributions, loading: false });
  },

  addGoal: async (goal) => {
    const user = await getCurrentUser();
    if (!user) return;

    const dbPayload = {
      user_id: user.id,
      title: goal.title,
      target_amount: Number(goal.targetAmount),
      current_amount: Number(goal.currentAmount) || 0,
      monthly_contribution: Number(goal.monthlyContribution) || 0,
      deadline: goal.deadline || null,
      icon: goal.icon || null,
      color: goal.color || null,
      currency: goal.currency || getCurrency(),
      horizon: goal.horizon || null,
      status: (Number(goal.currentAmount) || 0) >= Number(goal.targetAmount) ? 'completed' : 'active',
    };

    const { data, error } = await supabase.from('savings').insert(dbPayload).select().single();
    if (!error && data) {
      const formatted = {
        id: data.id,
        title: data.title,
        targetAmount: Number(data.target_amount),
        currentAmount: Number(data.current_amount),
        monthlyContribution: Number(data.monthly_contribution) || 0,
        deadline: data.deadline,
        icon: data.icon,
        color: data.color,
        status: data.status,
        currency: data.currency || 'DOP',
        horizon: data.horizon || null,
        createdAt: data.created_at,
      };
      set((state) => ({ goals: [...state.goals, formatted] }));
      return formatted;
    } else {
      if (import.meta.env.DEV) console.error('Error adding saving goal', error);
      toast.error(tr('stores.savings.createError'));
    }
  },

  // updateGoal acepta currentAmount a nivel de función (lo usan
  // addContribution/deleteContribution para mover el saldo). El formulario de
  // edición NO lo envía; el saldo solo cambia vía aportes.
  updateGoal: async (id, updates) => {
    const goal = get().goals.find((g) => g.id === id);
    if (!goal) return;
    const newCurrent = updates.currentAmount !== undefined ? Number(updates.currentAmount) : goal.currentAmount;
    const newTarget = updates.targetAmount !== undefined ? Number(updates.targetAmount) : goal.targetAmount;
    const wasCompleted = goal.status === 'completed';
    const newStatus = (newCurrent >= newTarget && newTarget > 0)
      ? 'completed'
      : (wasCompleted ? 'active' : (updates.status || goal.status));

    const dbUpdates = {};
    if (updates.title !== undefined) dbUpdates.title = updates.title;
    if (updates.targetAmount !== undefined) dbUpdates.target_amount = newTarget;
    if (updates.currentAmount !== undefined) dbUpdates.current_amount = newCurrent;
    if (updates.monthlyContribution !== undefined) dbUpdates.monthly_contribution = Number(updates.monthlyContribution) || 0;
    if (updates.deadline !== undefined) dbUpdates.deadline = updates.deadline || null;
    if (updates.icon !== undefined) dbUpdates.icon = updates.icon;
    if (updates.color !== undefined) dbUpdates.color = updates.color;
    if (updates.currency !== undefined) dbUpdates.currency = updates.currency;
    if (updates.horizon !== undefined) dbUpdates.horizon = updates.horizon || null;
    dbUpdates.status = newStatus;

    const { error } = await supabase.from('savings').update(dbUpdates).eq('id', id);
    if (error) {
      if (import.meta.env.DEV) console.error('Error updating saving goal', error);
      toast.error(tr('stores.savings.updateError'));
      return false;
    }
    set((state) => ({
      goals: state.goals.map((g) => (g.id === id ? { ...g, ...updates, currentAmount: newCurrent, targetAmount: newTarget, status: newStatus } : g)),
    }));
    return true;
  },

  deleteGoal: async (id) => {
    // ON DELETE CASCADE borra las savings_contributions en BD. Las transacciones
    // enlazadas de esos aportes se borran explícitamente (igual que en demo y
    // simétrico con restoreGoalWithContributions, que las recrea).
    const txIds = get().contributions.filter((c) => c.goalId === id && c.transactionId).map((c) => c.transactionId);
    const { error } = await supabase.from('savings').delete().eq('id', id);
    if (!error) {
      for (const txId of txIds) await useTransactionStore.getState().deleteTransactionSilent(txId);
      set((state) => ({
        goals: state.goals.filter((g) => g.id !== id),
        contributions: state.contributions.filter((c) => c.goalId !== id),
      }));
    }
  },

  // Registra un aporte: inserta fila en savings_contributions, suma al saldo de
  // la meta y crea la transacción de ahorro enlazada (transaction_id), espejo de
  // addPayment en useDebtStore.
  addContribution: async (goalId, amount, date, notes = '') => {
    const user = await getCurrentUser();
    if (!user) return;
    const goal = get().goals.find((g) => g.id === goalId);
    if (!goal) return;

    const value = Number(amount);
    const contribPayload = {
      user_id: user.id,
      goal_id: goalId,
      amount: value,
      date,
      notes: notes || null,
    };
    const { data: contribData, error: contribErr } = await supabase
      .from('savings_contributions').insert(contribPayload).select().single();
    if (contribErr) {
      if (import.meta.env.DEV) console.error('Error adding contribution', contribErr);
      toast.error(tr('stores.savings.contributionError'));
      return;
    }

    // Sube el saldo de la meta (vía updateGoal, que recalcula status).
    const newAmount = Number(goal.currentAmount) + value;
    await get().updateGoal(goalId, { currentAmount: newAmount });

    const formatted = {
      id: contribData.id, goalId, amount: value, date,
      notes: contribData.notes, transactionId: null, createdAt: contribData.created_at,
    };
    set((state) => ({ contributions: [...state.contributions, formatted] }));

    // Transacción de ahorro enlazada (base caja), igual que Deudas.
    try {
      const addTransaction = useTransactionStore.getState().addTransaction;
      const txId = await addTransaction({
        amount: value,
        type: 'savings',
        description: `Aporte a meta - ${goal.title}`,
        date,
        categoryId: savingsCategoryId(),
        currency: goal.currency || 'DOP',
        notes: notes || 'Generado automáticamente desde Ahorros',
      });
      if (txId) {
        await supabase.from('savings_contributions').update({ transaction_id: txId }).eq('id', contribData.id);
        set((state) => ({
          contributions: state.contributions.map((c) => (c.id === contribData.id ? { ...c, transactionId: txId } : c)),
        }));
      } else {
        toast(tr('stores.savings.contributionNoTransaction'), { duration: 5000 });
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('Error syncing contribution with transactions:', err);
      toast(tr('stores.savings.contributionLinkError'), { duration: 5000 });
    }
  },

  // Elimina un aporte: revierte el saldo de la meta y borra la transacción
  // enlazada. Devuelve { ok, hadTransactionLink } como deletePayment.
  deleteContribution: async (id) => {
    const contrib = get().contributions.find((c) => c.id === id);
    if (!contrib) return { ok: false };
    const goal = get().goals.find((g) => g.id === contrib.goalId);

    // Revertir el saldo de la meta PRIMERO; si falla, abortar sin borrar la fila.
    if (goal) {
      const restored = Math.max(0, Number(goal.currentAmount) - Number(contrib.amount));
      const ok = await get().updateGoal(goal.id, { currentAmount: restored });
      if (!ok) {
        toast.error(tr('stores.savings.revertBalanceError'));
        return { ok: false };
      }
    }

    const { error } = await supabase.from('savings_contributions').delete().eq('id', id);
    if (error) {
      if (import.meta.env.DEV) console.error('Error deleting contribution', error);
      toast.error(tr('stores.savings.deleteContributionError'));
      return { ok: false };
    }

    if (contrib.transactionId) {
      await useTransactionStore.getState().deleteTransactionSilent(contrib.transactionId);
    }

    set((state) => ({ contributions: state.contributions.filter((c) => c.id !== id) }));
    return { ok: true, hadTransactionLink: !!contrib.transactionId };
  },

  // Restaura un aporte eliminado (Deshacer): re-aplica vía addContribution.
  restoreContribution: async (contrib) => {
    if (!contrib) return false;
    await get().addContribution(contrib.goalId, contrib.amount, contrib.date, contrib.notes || '');
    return true;
  },

  // Restaura una meta eliminada CON sus aportes (Deshacer del shell), espejo de
  // demoRestoreGoal en PROD. Recrea la meta a su saldo ORIGINAL exacto (sin
  // re-sumar) e inserta las filas de aporte tal cual, recreando su transacción
  // enlazada. NO usa addGoal/addContribution para evitar el doble-conteo del saldo.
  restoreGoalWithContributions: async (goal, contribs = []) => {
    const user = await getCurrentUser();
    if (!user) return;

    const dbPayload = {
      user_id: user.id,
      title: goal.title,
      target_amount: Number(goal.targetAmount),
      current_amount: Number(goal.currentAmount),
      monthly_contribution: Number(goal.monthlyContribution) || 0,
      deadline: goal.deadline || null,
      icon: goal.icon || null,
      color: goal.color || null,
      currency: goal.currency || 'DOP',
      horizon: goal.horizon || null,
      status: goal.status || ((Number(goal.currentAmount) || 0) >= Number(goal.targetAmount) ? 'completed' : 'active'),
    };

    const { data: goalData, error: goalErr } = await supabase.from('savings').insert(dbPayload).select().single();
    if (goalErr || !goalData) {
      if (import.meta.env.DEV) console.error('Error restoring saving goal', goalErr);
      toast.error(tr('stores.savings.restoreError'));
      return;
    }
    const formatted = {
      id: goalData.id,
      title: goalData.title,
      targetAmount: Number(goalData.target_amount),
      currentAmount: Number(goalData.current_amount),
      monthlyContribution: Number(goalData.monthly_contribution) || 0,
      deadline: goalData.deadline,
      icon: goalData.icon,
      color: goalData.color,
      status: goalData.status,
      currency: goalData.currency || 'DOP',
      horizon: goalData.horizon || null,
      createdAt: goalData.created_at,
    };
    set((state) => ({ goals: [...state.goals, formatted] }));
    const newGoalId = goalData.id;

    for (const c of contribs) {
      try {
        const contribPayload = {
          user_id: user.id,
          goal_id: newGoalId,
          amount: Number(c.amount),
          date: c.date,
          notes: c.notes || null,
        };
        const { data: contribData, error: contribErr } = await supabase
          .from('savings_contributions').insert(contribPayload).select().single();
        if (contribErr || !contribData) {
          if (import.meta.env.DEV) console.error('Error restoring contribution', contribErr);
          continue;
        }

        let txId = null;
        try {
          txId = await useTransactionStore.getState().addTransaction({
            amount: Number(c.amount),
            type: 'savings',
            description: `Aporte a meta - ${goal.title}`,
            date: c.date,
            categoryId: savingsCategoryId(),
            currency: goal.currency || 'DOP',
            notes: c.notes || 'Generado automáticamente desde Ahorros',
          });
        } catch (err) {
          if (import.meta.env.DEV) console.error('Error recreating linked transaction on restore:', err);
        }

        if (txId) {
          await supabase.from('savings_contributions').update({ transaction_id: txId }).eq('id', contribData.id);
        }
        set((state) => ({
          contributions: [...state.contributions, {
            id: contribData.id,
            goalId: newGoalId,
            amount: Number(contribData.amount),
            date: contribData.date,
            notes: contribData.notes,
            transactionId: txId || null,
            createdAt: contribData.created_at,
          }],
        }));
      } catch (err) {
        if (import.meta.env.DEV) console.error('Error restoring contribution row:', err);
      }
    }
  },

  togglePause: async (id) => {
    const goal = get().goals.find(g => g.id === id);
    if (!goal) return;
    
    const newStatus = goal.status === 'paused' ? 'active' : 'paused';
    await get().updateGoal(id, { status: newStatus });
  },

  getTotalSaved: () => {
    return get().goals.reduce((sum, g) => sum + Number(g.currentAmount), 0);
  },

  getActiveGoals: () => get().goals.filter((g) => g.status === 'active'),
}),
{
  name: 'fintrack-savings-cache',
  storage: createJSONStorage(() => sessionStorage),
  partialize: (state) => ({ goals: state.goals, contributions: state.contributions }),
}
)
);

export default useSavingsStore;
