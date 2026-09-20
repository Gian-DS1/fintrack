// Modal de crear/editar tarjeta. Dos modos:
//   - Predefinida: banco + tarjeta del catálogo (banco/nombre/color fijos), cashback
//     precargado y editable. Solo corte/pago se editan.
//   - Personalizada: formulario libre (nombre, banco, corte, pago, color, cashback).
import { useState } from 'react';
import toast from 'react-hot-toast';
import MS from '../../MS';
import StitchSelect from '../../StitchSelect';
import StitchCurrencyInput from '../../StitchCurrencyInput';
import { isDemoActive } from '../../demoMode';
import { useI18n } from '../../../contexts/I18nContext';
import useCreditCardStore from '../../../stores/useCreditCardStore';
import useCategoryStore from '../../../stores/useCategoryStore';
import { getCatalogBanks, getCatalogCardsByBank, getCatalogCard, resolveCardCashback } from '../../../data/creditCardCatalog';
import { normalizeCashbackRules } from '../../../utils/creditCards';
import { Modal, Field, FormActions, inputCls } from '../../formUi';
import CashbackEditor from './CashbackEditor';

const COLORS = ['#bec2ff', '#50d8e9', '#bdd200', '#ffb689', '#ffb4ab', '#9aa0ff', '#e9a0d8'];
const blank = { name: '', bank: '', cutoffDay: '', dueDay: '', color: '#bec2ff', openingBalance: '', cashbackRules: [], catalogId: null };

const dayCls = 'w-full bg-surface-container-lowest border border-border-subtle rounded py-sm px-md font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary inner-glow';

export default function CardForm({ editing, onClose }) {
  const { t } = useI18n();
  const { addCard, updateCard } = useCreditCardStore();
  const categories = useCategoryStore((s) => s.categories);
  const demo = isDemoActive();

  const initial = editing
    ? { ...blank, ...editing, cutoffDay: String(editing.cutoffDay), dueDay: String(editing.dueDay), openingBalance: editing.openingBalance ? String(editing.openingBalance) : '' }
    : blank;
  const [mode, setMode] = useState(editing?.catalogId ? 'catalog' : editing ? 'custom' : 'catalog');
  const [form, setForm] = useState(initial);
  const [bank, setBank] = useState(editing?.bank || '');
  const [resolving, setResolving] = useState(false);
  const [showCashback, setShowCashback] = useState(false);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const ensureCat = useCategoryStore.getState().ensureCategory;

  const loadCatalogCard = async (catalogId) => {
    const tpl = getCatalogCard(catalogId);
    if (!tpl) return;
    setResolving(true);
    const rules = await resolveCardCashback(tpl, categories, ensureCat);
    setForm((f) => ({ ...f, name: tpl.name, bank: tpl.bank, color: tpl.color || f.color, catalogId: tpl.id, cashbackRules: rules }));
    setResolving(false);
  };

  const restoreCashback = async () => {
    if (!form.catalogId) return;
    const tpl = getCatalogCard(form.catalogId);
    setResolving(true);
    const rules = await resolveCardCashback(tpl, categories, ensureCat);
    set({ cashbackRules: rules });
    setResolving(false);
    toast.success(t('screens.cards.cashbackRestored'));
  };

  const switchMode = (m) => {
    setMode(m);
    if (m === 'custom') set({ catalogId: null });
  };

  const submit = async (e) => {
    e.preventDefault();
    const cutoffDay = parseInt(form.cutoffDay, 10), dueDay = parseInt(form.dueDay, 10);
    if (!form.name || !(cutoffDay >= 1 && cutoffDay <= 31) || !(dueDay >= 1 && dueDay <= 31)) {
      toast.error(t('screens.cards.completeNameDays'));
      return;
    }
    // Preserva reglas escalonadas (tiers) y planas (percentage); descarta vacías.
    const cashbackRules = normalizeCashbackRules(form.cashbackRules);
    const payload = { name: form.name, bank: form.bank, cutoffDay, dueDay, color: form.color, openingBalance: Number(form.openingBalance) || 0, cashbackRules, catalogId: form.catalogId || null };

    if (editing) await updateCard(editing.id, payload);
    else await addCard(payload);
    onClose();
  };

  const banks = getCatalogBanks();
  const catalogCards = bank ? getCatalogCardsByBank(bank) : [];
  const demoNote = demo ? t('screens.cards.ecosystemNote') : null;

  return (
    <Modal title={editing ? t('screens.cards.editCard') : t('common.newCard')} onClose={onClose} width="520px">
      {/* Tabs de modo (solo al crear; al editar el modo queda fijo) */}
      {!editing && (
        <div className="flex gap-xs mb-lg p-xs bg-surface-container-lowest border border-border-subtle rounded inner-glow">
          {[{ v: 'catalog', l: t('screens.cards.predefined') }, { v: 'custom', l: t('screens.cards.custom') }].map((tab) => (
            <button key={tab.v} type="button" onClick={() => switchMode(tab.v)} className={`flex-1 py-xs rounded font-mono-data text-mono-data uppercase transition-colors ${mode === tab.v ? 'bg-primary text-on-primary' : 'text-text-muted hover:text-on-surface'}`}>{tab.l}</button>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="flex flex-col gap-md">
        {mode === 'catalog' ? (
          <>
            {!editing && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
                <Field label={t('screens.cards.bank')}>
                  <StitchSelect value={bank} onChange={(b) => { setBank(b); set({ catalogId: null, name: '' }); }} options={banks.map((b) => ({ value: b, label: b }))} placeholder={t('screens.cards.chooseBank')} />
                </Field>
                <Field label={t('creditCards.card')}>
                  <StitchSelect value={form.catalogId || ''} onChange={loadCatalogCard} options={catalogCards.map((c) => ({ value: c.id, label: c.name }))} placeholder={bank ? t('screens.cards.chooseCard') : t('screens.cards.bankFirst')} />
                </Field>
              </div>
            )}
            {(form.catalogId || editing) && (
              <div className="bg-surface-container-lowest border border-border-subtle rounded p-md inner-glow flex items-center gap-sm">
                <span className="w-2 h-2 rounded-full glow-dot" style={{ background: form.color, color: form.color }} />
                <span className="font-label-sm text-label-sm text-on-surface">{form.name}</span>
                <span className="font-mono-data text-mono-data text-text-muted ml-auto">{form.bank}</span>
              </div>
            )}
          </>
        ) : (
          <>
            <Field label={t('common.name')}><input value={form.name} onChange={(e) => set({ name: e.target.value })} className={inputCls} placeholder={t('screens.cards.exampleCardName')} /></Field>
            <Field label={t('screens.cards.bank')}><input value={form.bank} onChange={(e) => set({ bank: e.target.value })} className={inputCls} placeholder={t('screens.debts.exampleCreditor')} /></Field>
            <Field label={t('categories.color')}>
              <div className="flex gap-sm">{COLORS.map((c) => <button type="button" key={c} onClick={() => set({ color: c })} className={`w-7 h-7 rounded-full border-2 ${form.color === c ? 'border-on-surface' : 'border-transparent'}`} style={{ background: c }} />)}</div>
            </Field>
          </>
        )}

        {/* Corte / pago: siempre editables */}
        <div className="grid grid-cols-2 gap-md">
          <Field label={t('screens.cards.cutoffDay')}><input inputMode="numeric" value={form.cutoffDay} onChange={(e) => set({ cutoffDay: e.target.value.replace(/\D/g, '').slice(0, 2) })} className={dayCls} placeholder="1-31" /></Field>
          <Field label={t('screens.cards.dueDay')}><input inputMode="numeric" value={form.dueDay} onChange={(e) => set({ dueDay: e.target.value.replace(/\D/g, '').slice(0, 2) })} className={dayCls} placeholder="1-31" /></Field>
        </div>

        {/* Saldo inicial: deuda que YA tenías antes de usar la app. */}
        <Field label={t('screens.cards.openingBalanceLabel')}>
          <StitchCurrencyInput value={form.openingBalance} onChange={(v) => set({ openingBalance: v })} placeholder="0" className={inputCls} />
          <span className="font-mono-data text-mono-data text-text-muted normal-case tracking-normal mt-xs block">
            {t('screens.cards.openingBalanceHint')}
          </span>
        </Field>

        {/* Cashback (colapsable) */}
        <div className="border border-border-subtle rounded inner-glow">
          <button type="button" onClick={() => setShowCashback((s) => !s)} className="w-full flex items-center justify-between px-md py-sm">
            <span className="font-mono-data text-mono-data text-on-surface-variant uppercase flex items-center gap-xs">
              <MS name="paid" className="!text-[14px] text-tertiary" /> Cashback {resolving && `· ${t('screens.cards.loading')}`}
            </span>
            <MS name="expand_more" className={`!text-[18px] text-text-muted transition-transform ${showCashback ? 'rotate-180' : ''}`} />
          </button>
          {showCashback && (
            <div className="px-md pb-md pt-xs border-t border-border-subtle">
              <CashbackEditor
                rules={form.cashbackRules || []}
                onChange={(rules) => set({ cashbackRules: rules })}
                onRestore={form.catalogId ? restoreCashback : null}
                demoNote={demoNote}
              />
            </div>
          )}
        </div>

        <FormActions onCancel={onClose} label={editing ? t('common.save') : t('common.create')} disabled={resolving} />
      </form>
    </Modal>
  );
}
