// Hook unificado para procesar pagos con cascada contra ahorros (tarjetas y préstamos).
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useI18n } from '../../../contexts/I18nContext';
import useSavingsStore from '../../../stores/useSavingsStore';
import usePrefsStore from '../../../stores/usePrefsStore';
import useCreditCardStore from '../../../stores/useCreditCardStore';
import useTransactionStore from '../../../stores/useTransactionStore';
import { getCashShortfall, canAffordPayment } from '../dashboard/selectors';
import { formatCurrency } from '../../../utils/formatters';

export function useCascadePayment({ onPay }) {
  const { t } = useI18n();
  const [picker, setPicker] = useState(null);

  const transactions = useTransactionStore((s) => s.transactions);
  const cards = useCreditCardStore((s) => s.cards);
  const goals = useSavingsStore((s) => s.goals);
  const getTotalSaved = useSavingsStore((s) => s.getTotalSaved);
  const initialCashBalance = usePrefsStore((s) => s.initialCashBalance);

  const processPayment = (amt, currency) => {
    const value = Number(amt);
    if (!value || value <= 0) return false;

    const { available, shortfall } = getCashShortfall(transactions, initialCashBalance, cards, value);
    if (shortfall === 0) {
      onPay(value, null);
      return true;
    }

    const totalSavings = getTotalSaved();
    if (!canAffordPayment(available, totalSavings, value)) {
      toast.error(
        t('cascade.noFunds')
          .replace('{avail}', formatCurrency(available + totalSavings, currency))
          .replace('{need}', formatCurrency(value, currency))
      );
      return false;
    }

    const hasEligible = goals.some((g) => g.status !== 'completed' && Number(g.currentAmount) >= shortfall);
    if (!hasEligible) {
      toast.error(t('cascade.noSingleGoal').replace('{amt}', formatCurrency(shortfall, currency)));
      return false;
    }

    setPicker({ shortfall, amt: value });
    return true;
  };

  const handlePickGoal = (savingsPick) => {
    if (!picker) return;
    onPay(picker.amt, savingsPick);
    setPicker(null);
  };

  const closePicker = () => setPicker(null);

  return {
    picker,
    processPayment,
    handlePickGoal,
    closePicker,
    goals,
  };
}
