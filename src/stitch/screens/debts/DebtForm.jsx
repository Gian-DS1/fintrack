// Modal de crear/editar deuda. Inputs Stitch + demo branching.
import { useState } from 'react';
import toast from 'react-hot-toast';
import StitchCurrencyInput from '../../StitchCurrencyInput';
import StitchDatePicker from '../../StitchDatePicker';
import useDebtStore from '../../../stores/useDebtStore';
import { isDemoActive, demoAddDebt, demoUpdateDebt } from '../../demoMode';
import { useI18n } from '../../../contexts/I18nContext';
import { Modal, Field, FormActions, inputCls } from '../../formUi';

const blank = { creditorName: '', originalAmount: '', currentBalance: '', interestRate: '', monthlyPayment: '', dueDate: '' };

const pctCls = 'w-full bg-surface-container-lowest border border-border-subtle rounded py-sm pl-md pr-[26px] font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary inner-glow';

export default function DebtForm({ editing, onClose }) {
  const { t } = useI18n();
  const { addDebt, updateDebt } = useDebtStore();
  const demo = isDemoActive();

  const [form, setForm] = useState(editing
    ? {
        creditorName: editing.creditorName, originalAmount: String(editing.originalAmount),
        currentBalance: String(editing.currentBalance), interestRate: String(editing.interestRate),
        monthlyPayment: String(editing.monthlyPayment), dueDate: editing.due_date || '',
      }
    : blank);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.creditorName.trim() || !Number(form.originalAmount)) {
      toast.error(t('screens.debts.completeCreditorAmount'));
      return;
    }
    const data = {
      creditorName: form.creditorName.trim(), originalAmount: Number(form.originalAmount),
      currentBalance: Number(form.currentBalance || form.originalAmount), interestRate: Number(form.interestRate) || 0,
      monthlyPayment: Number(form.monthlyPayment) || 0, dueDate: form.dueDate || null,
    };
    if (editing) {
      if (demo) { demoUpdateDebt(editing.id, data); toast.success(t('screens.debts.debtUpdated')); }
      else { await updateDebt(editing.id, data); toast.success(t('screens.debts.debtUpdated')); }
    } else {
      if (demo) { demoAddDebt(data); toast.success(t('screens.debts.debtRegistered')); }
      else { await addDebt(data); toast.success(t('screens.debts.debtRegistered')); }
    }
    onClose();
  };

  return (
    <Modal title={editing ? t('screens.debts.editDebt') : t('common.newDebt')} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-md">
        <Field label={t('debts.creditor')}><input value={form.creditorName} onChange={(e) => set({ creditorName: e.target.value })} className={inputCls} placeholder={t('screens.debts.exampleCreditor')} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-md">
          <Field label={t('screens.debts.originalAmount')}><StitchCurrencyInput value={form.originalAmount} onChange={(v) => set({ originalAmount: v })} className={inputCls} /></Field>
          <Field label={t('screens.debts.currentBalance')} hint={t('screens.debts.emptyEqualsOriginal')}><StitchCurrencyInput value={form.currentBalance} onChange={(v) => set({ currentBalance: v })} className={inputCls} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-md">
          <Field label={t('screens.debts.interestTNA')}>
            <div className="relative">
              <input inputMode="decimal" value={form.interestRate} onChange={(e) => set({ interestRate: e.target.value.replace(/[^0-9.]/g, '') })} className={pctCls} placeholder="0" />
              <span className="absolute right-sm top-1/2 -translate-y-1/2 font-mono-data text-mono-data text-text-muted">%</span>
            </div>
          </Field>
          <Field label={t('screens.debts.monthlyQuota')}><StitchCurrencyInput value={form.monthlyPayment} onChange={(v) => set({ monthlyPayment: v })} className={inputCls} /></Field>
        </div>
        <Field label={t('screens.debts.nextPayment')}><StitchDatePicker value={form.dueDate} onChange={(v) => set({ dueDate: v })} /></Field>
        <FormActions onCancel={onClose} label={editing ? t('common.save') : t('screens.debts.register')} />
      </form>
    </Modal>
  );
}
