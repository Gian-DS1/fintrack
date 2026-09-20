// Modal de abono a una tarjeta: monto + fecha + nota. El abono LIQUIDA el saldo,
// no es un gasto del presupuesto (el gasto ya se contó al consumir).
import { useState } from 'react';
import toast from 'react-hot-toast';
import StitchCurrencyInput from '../../StitchCurrencyInput';
import StitchDatePicker from '../../StitchDatePicker';
import { isDemoActive, demoAddCardPayment, applyCardPaymentWithCascade } from '../../demoMode';
import { useI18n } from '../../../contexts/I18nContext';
import useCreditCardStore from '../../../stores/useCreditCardStore';
import useSavingsStore from '../../../stores/useSavingsStore';
import usePrefsStore from '../../../stores/usePrefsStore';
import { getCardBalances } from '../../../utils/creditCards';
import { todayISO, formatCurrency } from '../../../utils/formatters';
import { toastCelebrate } from '../../toastCelebrate';
import { Modal, Field, FormActions, inputCls } from '../../formUi';
import { getCashShortfall, canAffordPayment } from '../dashboard/selectors';
import SavingsPickerModal from '../finances/SavingsPickerModal';

const fmt = (n) => formatCurrency(n);

export default function PaymentModal({ card, transactions, onClose }) {
  const { t } = useI18n();
  const addCardPayment = useCreditCardStore((s) => s.addCardPayment);
  const addCardPaymentWithCascade = useCreditCardStore((s) => s.addCardPaymentWithCascade);
  const cards = useCreditCardStore((s) => s.cards);
  const goals = useSavingsStore((s) => s.goals);
  const getTotalSaved = useSavingsStore((s) => s.getTotalSaved);
  const initialCashBalance = usePrefsStore((s) => s.initialCashBalance);
  const bal = getCardBalances(card, transactions, new Date());
  // El monto SIEMPRE inicia vacío. Precargarlo con el total pendiente hacía que
  // un abono parcial se registrara por TODO el corte: el usuario veía el campo
  // lleno, escribía su monto en otro lado (p. ej. la nota) y confirmaba. Para
  // saldar el total está el botón "Pagar todo" de la tarjeta; aquí el usuario
  // teclea exactamente lo que abona (el pendiente se muestra arriba, informativo).
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [picker, setPicker] = useState(null);

  const applyPayment = (amt, savingsPick) => {
    const payload = { amount: amt, date, note: note.trim() };
    if (isDemoActive()) {
      if (savingsPick) applyCardPaymentWithCascade(card.id, payload, savingsPick);
      else demoAddCardPayment(card.id, payload);
      toast.success(t('screens.cards.paymentRegistered'));
    } else {
      if (savingsPick) addCardPaymentWithCascade(card.id, payload, savingsPick);
      else addCardPayment(card.id, payload);
    }
    // ¿Este abono SALDÓ un estado de cuenta que estaba pendiente?
    if (bal.pendingBilled > 0.01 && amt + bal.paid >= bal.billed - 0.01) {
      toastCelebrate(t('creditCards.amountPaid'));
    }
    if (savingsPick) {
      const g = goals.find((gg) => gg.id === savingsPick.goalId);
      toast(t('cascade.usedSavings').replace('{amt}', fmt(savingsPick.amount)).replace('{goal}', g?.title || ''), { icon: 'ℹ️' });
    }
    onClose();
  };

  const submit = (e) => {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt || amt <= 0) return;

    // La cascada corre en demo Y en cuenta real.
    const { available, shortfall } = getCashShortfall(transactions, initialCashBalance, cards, amt);
    if (shortfall === 0) { applyPayment(amt, null); return; }

    const totalSavings = getTotalSaved();
    if (!canAffordPayment(available, totalSavings, amt)) {
      toast.error(t('cascade.noFunds').replace('{avail}', fmt(available + totalSavings)).replace('{need}', fmt(amt)));
      return;
    }
    const hasEligible = goals.some((g) => g.status !== 'completed' && Number(g.currentAmount) >= shortfall);
    if (!hasEligible) {
      toast.error(t('cascade.noSingleGoal').replace('{amt}', fmt(shortfall)));
      return;
    }
    setPicker({ shortfall, amt });
  };

  return (
    <>
    <Modal title={`${t('screens.cards.paymentTitle')} · ${card.name}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-md">
        <div className="bg-surface-container-lowest border border-border-subtle rounded p-md inner-glow flex justify-between items-center">
          <span className="font-mono-data text-mono-data text-text-muted uppercase">{t('screens.cards.toPayLabel')}</span>
          <span className="font-mono-data text-[15px] text-on-surface">{fmt(bal.pendingBilled)}</span>
        </div>
        <Field label={t('screens.cards.paymentAmountLabel')}>
          <StitchCurrencyInput value={amount} onChange={setAmount} className={inputCls} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-md">
          <Field label={t('transactions.date')}><StitchDatePicker value={date} onChange={setDate} max={todayISO()} /></Field>
          <Field label={t('screens.vaults.noteOptional')}><input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder={t('screens.cards.examplePaymentNote')} /></Field>
        </div>
        <p className="font-mono-data text-mono-data text-text-muted normal-case tracking-normal">{t('screens.cards.paymentNote')}</p>
        <FormActions onCancel={onClose} label={t('screens.cards.registerPayment')} disabled={!Number(amount)} />
      </form>
    </Modal>
    {picker && (
      <SavingsPickerModal
        open
        shortfall={picker.shortfall}
        goals={goals}
        onPick={(pick) => { const amt = picker.amt; setPicker(null); applyPayment(amt, pick); }}
        onClose={() => setPicker(null)}
      />
    )}
    </>
  );
}
