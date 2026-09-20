// src/stitch/screens/categories/CategoryForm.jsx
// Modal crear/editar categoría. Campos: nombre, tipo, emoji, color, keywords.
import { useState } from 'react';
import toast from 'react-hot-toast';
import StitchSelect from '../../StitchSelect';
import EmojiPicker from '../../EmojiPicker';
import useCategoryStore from '../../../stores/useCategoryStore';
import { useI18n } from '../../../contexts/I18nContext';
import { Modal, Field, FormActions, inputCls } from '../../formUi';

const COLORS = ['#bec2ff', '#50d8e9', '#bdd200', '#ffb689', '#ffb4ab', '#9aa0ff', '#e9a0d8'];
const blank = { name: '', type: 'variable_expense', icon: '🏷️', color: '#bec2ff', keywords: '' };

export default function CategoryForm({ editing, onClose }) {
  const { t } = useI18n();
  const TYPE_OPTIONS = [
    { value: 'income', label: t('types.income') },
    { value: 'fixed_expense', label: t('types.fixed_expense') },
    { value: 'variable_expense', label: t('types.variable_expense') },
    { value: 'savings', label: t('types.savings') },
  ];
  const { addCategory, updateCategory } = useCategoryStore();

  const [form, setForm] = useState(editing
    ? {
        name: editing.name, type: editing.type, icon: editing.icon || '🏷️',
        color: editing.color || '#bec2ff',
        keywords: (editing.keywords || []).join(', '),
      }
    : blank);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error(t('screens.categories.nameRequired')); return; }
    const keywords = form.keywords.split(',').map((k) => k.trim()).filter(Boolean);
    const payload = {
      name: form.name.trim(), type: form.type, icon: form.icon, color: form.color, keywords,
    };
    if (editing) {
      await updateCategory(editing.id, payload);
      toast.success(t('screens.categories.updated'));
    } else {
      await addCategory(payload);
      toast.success(t('screens.categories.created'));
    }
    onClose();
  };

  return (
    <Modal title={editing ? t('screens.categories.edit') : t('common.newCategory')} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-md">
        <div className="flex gap-md items-end">
          <Field label={t('categories.icon')}><EmojiPicker value={form.icon} onChange={(char) => set({ icon: char })} /></Field>
          <div className="flex-1">
            <Field label={t('common.name')}><input value={form.name} onChange={(e) => set({ name: e.target.value })} className={inputCls} placeholder={t('screens.categories.exampleName')} autoFocus /></Field>
          </div>
        </div>
        <Field label={t('common.type')}>
          <StitchSelect value={form.type} onChange={(v) => set({ type: v })} options={TYPE_OPTIONS} />
        </Field>
        <Field label={t('categories.color')}>
          <div className="flex gap-sm">{COLORS.map((c) => <button type="button" key={c} onClick={() => set({ color: c })} className={`w-7 h-7 rounded-full border-2 ${form.color === c ? 'border-on-surface' : 'border-transparent'}`} style={{ background: c }} />)}</div>
        </Field>
        <Field label={t('screens.categories.keywords')} hint={t('screens.categories.keywordsHint')}>
          <input value={form.keywords} onChange={(e) => set({ keywords: e.target.value })} className={inputCls} placeholder={t('screens.categories.exampleKeywords')} />
        </Field>
        <FormActions onCancel={onClose} label={editing ? t('common.save') : t('common.create')} />
      </form>
    </Modal>
  );
}
