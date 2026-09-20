// Modal de crear/editar meta. Inputs Stitch. El saldo inicial
// solo se declara al CREAR (al editar el saldo cambia vía aportes).
import { useState } from 'react';
import toast from 'react-hot-toast';
import EmojiPicker from '../../EmojiPicker';
import StitchCurrencyInput from '../../StitchCurrencyInput';
import StitchSelect from '../../StitchSelect';
import StitchDatePicker from '../../StitchDatePicker';
import useSavingsStore from '../../../stores/useSavingsStore';
import { useI18n } from '../../../contexts/I18nContext';
import { Modal, Field, FormActions, inputCls } from '../../formUi';
import { getHorizonFormOptions } from './horizons';

const blank = { title: '', targetAmount: '', currentAmount: '', monthlyContribution: '', deadline: '', icon: '🎯', color: '#bec2ff', horizon: '' };

export default function VaultForm({ editing, onClose }) {
  const { t } = useI18n();
  const { addGoal, updateGoal } = useSavingsStore();

  const [form, setForm] = useState(editing
    ? {
        title: editing.title, targetAmount: String(editing.targetAmount),
        currentAmount: String(editing.currentAmount),
        monthlyContribution: editing.monthlyContribution ? String(editing.monthlyContribution) : '',
        deadline: editing.deadline || '', icon: editing.icon || '🎯',
        color: editing.color || '#bec2ff',
        horizon: editing.horizon || '',
      }
    : blank);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !Number(form.targetAmount)) {
      toast.error(t('screens.vaults.completeNameAmount'));
      return;
    }
    // Base común. El saldo inicial solo se envía al crear.
    const data = {
      title: form.title.trim(), targetAmount: Number(form.targetAmount),
      monthlyContribution: Number(form.monthlyContribution) || 0,
      deadline: form.deadline || null, icon: form.icon, color: form.color,
      horizon: form.horizon || null,
    };
    if (editing) {
      await updateGoal(editing.id, data);
      toast.success(t('screens.vaults.goalUpdated'));
    } else {
      await addGoal({ ...data, currentAmount: Number(form.currentAmount) || 0 });
      toast.success(t('screens.vaults.goalCreated'));
    }
    onClose();
  };

  return (
    <Modal title={editing ? t('screens.vaults.editGoal') : t('common.newGoal')} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-md">
        <Field label={t('common.name')}><input value={form.title} onChange={(e) => set({ title: e.target.value })} className={inputCls} placeholder={t('screens.vaults.exampleGoal')} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-md">
          <Field label={t('savings.goal')}><StitchCurrencyInput value={form.targetAmount} onChange={(v) => set({ targetAmount: v })} className={inputCls} /></Field>
          {editing
            ? <Field label={t('screens.vaults.monthlyContribution')} hint={t('screens.vaults.forProjection')}><StitchCurrencyInput value={form.monthlyContribution} onChange={(v) => set({ monthlyContribution: v })} className={inputCls} /></Field>
            : <Field label={t('screens.vaults.initialBalance')} hint={t('screens.vaults.whatYouHave')}><StitchCurrencyInput value={form.currentAmount} onChange={(v) => set({ currentAmount: v })} className={inputCls} /></Field>}
        </div>
        {!editing && (
          <Field label={t('screens.vaults.monthlyContribution')} hint={t('screens.vaults.forProjection')}><StitchCurrencyInput value={form.monthlyContribution} onChange={(v) => set({ monthlyContribution: v })} className={inputCls} /></Field>
        )}
        <Field label={t('screens.vaults.deadline')}><StitchDatePicker value={form.deadline} onChange={(v) => set({ deadline: v })} /></Field>
        <Field label={t('screens.vaults.horizon')} hint={t('screens.vaults.horizonHint')}>
          <StitchSelect value={form.horizon} onChange={(v) => set({ horizon: v })} options={getHorizonFormOptions()} placeholder={t('screens.vaults.noHorizon')} />
        </Field>
        <Field label={t('categories.icon')}>
          <EmojiPicker value={form.icon} onChange={(char) => set({ icon: char })} />
        </Field>
        <FormActions onCancel={onClose} label={editing ? t('common.save') : t('common.create')} />
      </form>
    </Modal>
  );
}
