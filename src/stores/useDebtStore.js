import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supabase, getCurrentUser } from '../lib/supabase';
import toast from 'react-hot-toast';
import useCategoryStore from './useCategoryStore';
import useTransactionStore from './useTransactionStore';
import useSavingsStore from './useSavingsStore';
import { getCurrency } from '../utils/currencyRuntime';
import { tr } from '../i18n/runtime';
import { isDemoActive } from '../stitch/demoMode';

// Id local para las filas creadas en modo demo (no hay Postgres que lo genere).
const localId = () =>
  (globalThis.crypto?.randomUUID?.() || `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`);

const useDebtStore = create(
  persist(
    (set, get) => ({
  debts: [],
  payments: [],
  loading: false,

  fetchDebtsAndPayments: async () => {
    if (isDemoActive()) return; // demo: los datos los siembra demoMode
    set({ loading: true });
    const user = await getCurrentUser();
    if (!user) return set({ debts: [], payments: [], loading: false });

    const [debtsRes, paymentsRes] = await Promise.all([
      supabase.from('debts').select('*').eq('user_id', user.id),
      supabase.from('debt_payments').select('*').eq('user_id', user.id)
    ]);

    if (debtsRes.error || paymentsRes.error) {
      if (import.meta.env.DEV) console.error('Error fetching debts/payments:', debtsRes.error || paymentsRes.error);
      toast.error(tr('stores.debts.loadError'));
    }

    let formattedDebts = [];
    if (!debtsRes.error && debtsRes.data) {
      formattedDebts = debtsRes.data.map(d => {
        // Moneda desde la columna `currency`. Para filas legadas (creadas antes
        // de la migración) que aún llevan el sufijo " [USD]" en el nombre, se
        // detecta por el sufijo y se limpia el nombre al mostrarlo.
        const hasSuffix = d.creditor_name && d.creditor_name.endsWith(' [USD]');
        const currency = d.currency || (hasSuffix ? 'USD' : 'DOP');
        const creditorName = hasSuffix ? d.creditor_name.slice(0, -6) : d.creditor_name;
        return {
          id: d.id,
          creditorName,
          originalAmount: Number(d.total_amount),
          currentBalance: Number(d.current_balance),
          interestRate: Number(d.interest_rate),
          monthlyPayment: Number(d.minimum_payment),
          due_date: d.due_date,
          status: d.status,
          currency,
          createdAt: d.created_at
        };
      });
    }

    let formattedPayments = [];
    if (!paymentsRes.error && paymentsRes.data) {
      formattedPayments = paymentsRes.data.map(p => ({
        id: p.id,
        debtId: p.debt_id,
        amount: Number(p.amount),
        date: p.date,
        remainingBalance: Number(p.remaining_balance),
        notes: p.notes,
        transactionId: p.transaction_id || null,
        savingsUsed: p.savings_used || [],
        createdAt: p.created_at
      }));
    }

    set({ debts: formattedDebts, payments: formattedPayments, loading: false });
  },

  addDebt: async (debt) => {
    const demo = isDemoActive();
    const user = demo ? null : await getCurrentUser();
    if (!demo && !user) return;

    const currentBal = Number(debt.currentBalance !== undefined ? debt.currentBalance : debt.originalAmount);
    const initialStatus = currentBal <= 0 ? 'paid_off' : 'active';
    const currency = debt.currency || getCurrency();

    if (demo) {
      // Conserva el id recibido para que el Deshacer restaure la deuda original.
      const formatted = {
        id: debt.id || localId(),
        creditorName: debt.creditorName,
        originalAmount: Number(debt.originalAmount),
        currentBalance: currentBal,
        interestRate: Number(debt.interestRate) || 0,
        monthlyPayment: Number(debt.monthlyPayment) || 0,
        due_date: debt.dueDate || debt.due_date || null,
        status: debt.status || initialStatus,
        currency,
        createdAt: debt.createdAt || new Date().toISOString(),
      };
      set((state) => ({ debts: [...state.debts, formatted] }));
      return formatted;
    }

    const dbPayload = {
      user_id: user.id,
      creditor_name: debt.creditorName,
      total_amount: Number(debt.originalAmount),
      current_balance: currentBal,
      interest_rate: Number(debt.interestRate) || 0,
      minimum_payment: Number(debt.monthlyPayment) || 0,
      due_date: debt.dueDate || null,
      status: initialStatus,
      currency,
    };

    const { data, error } = await supabase.from('debts').insert(dbPayload).select().single();
    if (!error && data) {
      const formatted = {
        id: data.id,
        creditorName: data.creditor_name,
        originalAmount: Number(data.total_amount),
        currentBalance: Number(data.current_balance),
        interestRate: Number(data.interest_rate),
        monthlyPayment: Number(data.minimum_payment),
        due_date: data.due_date,
        status: data.status,
        currency: data.currency || currency,
        createdAt: data.created_at
      };
      set((state) => ({ debts: [...state.debts, formatted] }));
    }
  },

  updateDebt: async (id, updates) => {
    const goal = get().debts.find(d => d.id === id);
    const currentCurrency = updates.currency !== undefined ? updates.currency : (goal?.currency || 'DOP');

    const dbUpdates = {};
    if (updates.creditorName !== undefined) dbUpdates.creditor_name = updates.creditorName;
    if (updates.currency !== undefined) dbUpdates.currency = updates.currency;

    if (updates.originalAmount !== undefined) dbUpdates.total_amount = Number(updates.originalAmount);

    let newCurrent = goal?.currentBalance || 0;
    // Track the resulting status in a local variable instead of mutating the
    // caller's `updates` object (mutating function args is a side-effect trap).
    let nextStatus = goal?.status || 'active';
    if (updates.currentBalance !== undefined) {
      newCurrent = Number(updates.currentBalance);
      dbUpdates.current_balance = newCurrent;
      nextStatus = newCurrent <= 0 ? 'paid_off' : 'active';
      dbUpdates.status = nextStatus;
    }

    if (updates.interestRate !== undefined) dbUpdates.interest_rate = Number(updates.interestRate);
    if (updates.monthlyPayment !== undefined) dbUpdates.minimum_payment = Number(updates.monthlyPayment);
    if (updates.dueDate !== undefined) dbUpdates.due_date = updates.dueDate || null;

    if (isDemoActive()) {
      set((state) => ({
        debts: state.debts.map((d) => (d.id === id ? { ...d, ...updates, currentBalance: newCurrent, status: nextStatus, currency: currentCurrency } : d)),
      }));
      return;
    }

    const { error } = await supabase.from('debts').update(dbUpdates).eq('id', id);
    if (!error) {
      set((state) => ({
        debts: state.debts.map((d) => (d.id === id ? { ...d, ...updates, currentBalance: newCurrent, status: nextStatus, currency: currentCurrency } : d)),
      }));
    }
  },

  deleteDebt: async (id) => {
    if (isDemoActive()) {
      set((state) => ({
        debts: state.debts.filter((d) => d.id !== id),
        payments: state.payments.filter((p) => p.debtId !== id),
      }));
      return;
    }

    // Due to ON DELETE CASCADE on debt_payments, deleting debt will delete its payments in DB
    const { error } = await supabase.from('debts').delete().eq('id', id);
    if (!error) {
      set((state) => ({
        debts: state.debts.filter((d) => d.id !== id),
        payments: state.payments.filter((p) => p.debtId !== id),
      }));
    }
  },

  addPayment: async (debtId, amount, date, notes = '', savingsUsed = []) => {
    const demo = isDemoActive();
    const user = demo ? null : await getCurrentUser();
    if (!demo && !user) return;

    const debt = get().debts.find((d) => d.id === debtId);
    if (!debt) return;

    const newBalance = Math.max(0, Number(debt.currentBalance) - Number(amount));
    const newStatus = newBalance <= 0 ? 'paid_off' : 'active';

    // En demo la fila del pago se crea en memoria; con sesión la inserta
    // Postgres. A partir de `formattedPayment` el flujo es idéntico: baja el
    // saldo de la deuda y enlaza la transacción del pago.
    let paymentData;
    if (demo) {
      paymentData = {
        id: localId(),
        debt_id: debtId,
        amount: Number(amount),
        date,
        remaining_balance: newBalance,
        notes: notes || null,
        savings_used: savingsUsed,
        created_at: new Date().toISOString(),
      };
    } else {
      const paymentPayload = {
        user_id: user.id,
        debt_id: debtId,
        amount: Number(amount),
        date: date,
        remaining_balance: newBalance,
        notes: notes || null,
        savings_used: savingsUsed,
      };

      // We do both: insert payment and update debt
      const { data, error: paymentError } = await supabase.from('debt_payments').insert(paymentPayload).select().single();
      if (paymentError) {
        if (import.meta.env.DEV) console.error("Error adding payment", paymentError);
        return;
      }
      paymentData = data;

      const { error: debtError } = await supabase.from('debts').update({ current_balance: newBalance, status: newStatus }).eq('id', debtId);
      if (debtError || !paymentData) return;
    }

    {
      const formattedPayment = {
        id: paymentData.id,
        debtId: paymentData.debt_id,
        amount: Number(paymentData.amount),
        date: paymentData.date,
        remainingBalance: Number(paymentData.remaining_balance),
        notes: paymentData.notes,
        transactionId: null,
        savingsUsed: paymentData.savings_used || [],
        createdAt: paymentData.created_at
      };

      set((state) => ({
        payments: [...state.payments, formattedPayment],
        debts: state.debts.map((d) =>
          d.id === debtId
            ? { ...d, currentBalance: newBalance, status: newStatus }
            : d
        ),
      }));

      // Sync with Transactions y guarda el enlace (transaction_id) en el pago,
      // para poder revertir EXACTAMENTE esta transacción si el pago se elimina.
      try {
        const categories = useCategoryStore.getState().categories;
        // Buscar por slug estable; respaldo por nombre para cuentas previas a la
        // migración del slug.
        let loanCategory =
          categories.find((c) => c.slug === 'pago-deuda') ||
          categories.find((c) => c.name === 'Pago de Préstamos y Deudas' || (c.name && c.name.includes('Préstamos')));

        // Tras el reinicio del modelo financiero las cuentas arrancan SIN
        // categorías semilla, así que "Pago de Préstamos y Deudas" puede no
        // existir todavía. En vez de saltarnos la sincronización (lo que dejaría
        // el abono fuera del flujo de transacciones), creamos la categoría la
        // primera vez que se registra un pago. ensureCategory es idempotente:
        // los pagos siguientes reusan la misma. Así el usuario no tiene que
        // crearla ni vincularla a mano.
        if (!loanCategory) {
          const newId = await useCategoryStore.getState().ensureCategory({
            slug: 'pago-deuda',
            name: 'Pago de Préstamos y Deudas',
            type: 'fixed_expense',
            icon: '🏛️',
            color: '#dc2626',
            keywords: ['prestamo', 'prestamos', 'cuota', 'capital', 'abono a deuda', 'financiamiento', 'asociacion', 'cooperativa'],
          });
          if (newId) {
            loanCategory = useCategoryStore.getState().categories.find((c) => c.id === newId);
          }
        }

        if (loanCategory) {
          const addTransaction = useTransactionStore.getState().addTransaction;
          const currency = debt.currency || 'DOP';

          const txId = await addTransaction({
            amount: Number(amount),
            type: 'fixed_expense',
            description: `Pago cuota - ${debt.creditorName}`,
            date: date,
            categoryId: loanCategory.id,
            currency: currency,
            notes: notes || 'Generado automáticamente desde Deudas'
          });

          if (txId) {
            // Enlaza el pago con la transacción (DB + estado local).
            if (!isDemoActive()) {
              await supabase.from('debt_payments').update({ transaction_id: txId }).eq('id', paymentData.id);
            }
            set((state) => ({
              payments: state.payments.map((p) =>
                p.id === paymentData.id ? { ...p, transactionId: txId } : p
              ),
            }));
          }
        }
      } catch (err) {
        if (import.meta.env.DEV) console.error('Error syncing debt payment with transactions:', err);
      }
    }
  },

  // Pago de deuda con cascada (cuenta real). Si savingsPick no es null, retira ese
  // monto del ahorro (aporte negativo → baja la meta y devuelve efectivo) y registra
  // el pago con savingsUsed para la reversa. Vale igual en demo y con sesión:
  // addContribution y addPayment ya resuelven cada modo por dentro.
  addPaymentWithCascade: async (debtId, amount, date, notes, savingsPick) => {
    const savingsUsed = [];
    if (savingsPick && savingsPick.amount > 0) {
      await useSavingsStore.getState().addContribution(savingsPick.goalId, -Math.abs(savingsPick.amount), date, 'Retiro para pago de deuda');
      savingsUsed.push({ goalId: savingsPick.goalId, amount: Math.abs(savingsPick.amount) });
    }
    return get().addPayment(debtId, amount, date, notes, savingsUsed);
  },

  // Elimina un pago y revierte todo lo que addPayment hizo: devuelve el monto al
  // saldo de la deuda, recalcula el estado, borra la fila del pago y, si está
  // enlazada, borra también la transacción generada. Pagos legados sin
  // transaction_id revierten el saldo pero conservan su transacción (se avisa).
  // Devuelve { ok, payment, hadLinkedTx } para que la UI ofrezca "Deshacer".
  deletePayment: async (paymentId) => {
    const payment = get().payments.find((p) => p.id === paymentId);
    if (!payment) return { ok: false };
    // Reversa de cascada: devuelve a cada meta lo que el pago tomó del ahorro.
    for (const s of payment.savingsUsed || []) {
      await useSavingsStore.getState().addContribution(s.goalId, Math.abs(s.amount), payment.date, 'Reversa de retiro por pago');
    }
    const debt = get().debts.find((d) => d.id === payment.debtId);

    // Revertir saldo + estado de la deuda (si la deuda aún existe).
    if (debt && !isDemoActive()) {
      const restoredBalance = Number(debt.currentBalance) + Number(payment.amount);
      const restoredStatus = restoredBalance > 0 ? 'active' : 'paid_off';
      const { error: debtErr } = await supabase
        .from('debts')
        .update({ current_balance: restoredBalance, status: restoredStatus })
        .eq('id', debt.id);
      if (debtErr) {
        if (import.meta.env.DEV) console.error('Error reverting debt balance on payment delete:', debtErr);
        toast.error(tr('stores.debts.revertBalanceError'));
        return { ok: false };
      }
    }

    // Borrar la fila del pago.
    if (!isDemoActive()) {
      const { error: payErr } = await supabase.from('debt_payments').delete().eq('id', paymentId);
      if (payErr) {
        if (import.meta.env.DEV) console.error('Error deleting payment:', payErr);
        toast.error(tr('stores.debts.deletePaymentError'));
        return { ok: false };
      }
    }

    // Borrar la transacción enlazada (solo pagos nuevos la tienen).
    let hadLinkedTx = false;
    if (payment.transactionId) {
      const ok = await useTransactionStore.getState().deleteTransactionSilent(payment.transactionId);
      hadLinkedTx = ok;
    }

    set((state) => ({
      payments: state.payments.filter((p) => p.id !== paymentId),
      debts: debt
        ? state.debts.map((d) =>
            d.id === debt.id
              ? {
                  ...d,
                  currentBalance: Number(d.currentBalance) + Number(payment.amount),
                  status: Number(d.currentBalance) + Number(payment.amount) > 0 ? 'active' : 'paid_off',
                }
              : d
          )
        : state.debts,
    }));

    return { ok: true, payment, hadLinkedTx, hadTransactionLink: !!payment.transactionId };
  },

  // Restaura un pago eliminado (para "Deshacer"): re-aplica el pago tal cual,
  // recreando su transacción enlazada vía el flujo normal de addPayment.
  restorePayment: async (payment) => {
    if (!payment) return false;
    await get().addPayment(payment.debtId, payment.amount, payment.date, payment.notes || '');
    return true;
  },

  getPaymentsByDebt: (debtId) => {
    return get().payments.filter((p) => p.debtId === debtId).sort((a, b) => a.date.localeCompare(b.date));
  },

  getTotalDebt: () => {
    return get()
      .debts.filter((d) => d.status === 'active')
      .reduce((sum, d) => sum + Number(d.currentBalance), 0);
  },

  getTotalMonthlyPayment: () => {
    return get()
      .debts.filter((d) => d.status === 'active')
      .reduce((sum, d) => sum + Number(d.monthlyPayment), 0);
  },

  getActiveDebts: () => get().debts.filter((d) => d.status === 'active'),
}),
{
  name: 'fintrack-debts-cache',
  storage: createJSONStorage(() => sessionStorage),
  partialize: (state) => ({ debts: state.debts, payments: state.payments }),
}
)
);

export default useDebtStore;
