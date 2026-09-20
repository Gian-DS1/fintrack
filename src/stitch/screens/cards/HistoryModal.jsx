// Modal de historial de abonos de una tarjeta. Lista los abonos (fecha, monto,
// nota) de más reciente a más antiguo, con cashback de por vida arriba y borrar
// con deshacer.
import { toastUndo } from '../../toastUndo';
import MS from '../../MS';
import { isDemoActive, demoDeleteCardPayment, demoAddCardPayment } from '../../demoMode';
import { useI18n } from '../../../contexts/I18nContext';
import { tr } from '../../../i18n/runtime';
import useCreditCardStore from '../../../stores/useCreditCardStore';
import { getLifetimeCashback } from '../../../utils/creditCards';
import { formatCurrency, formatDate } from '../../../utils/formatters';
import { Modal } from '../../formUi';

const fmt = (n) => formatCurrency(n);

export default function HistoryModal({ card, transactions, onClose }) {
  const { t } = useI18n();
  const { addCardPayment, deleteCardPayment } = useCreditCardStore();
  const demo = isDemoActive();
  const payments = [...(card.payments || [])].sort((a, b) => (a.date < b.date ? 1 : -1));
  const cashback = getLifetimeCashback(card, transactions);

  const onDelete = (p) => {
    if (demo) demoDeleteCardPayment(card.id, p.id); else deleteCardPayment(card.id, p.id);
    toastUndo(tr('screens.cards.paymentDeleted'), () => {
      if (demo) demoAddCardPayment(card.id, p); else addCardPayment(card.id, p);
    });
  };

  return (
    <Modal title={`${t('screens.cards.paymentsTitle')} · ${card.name}`} onClose={onClose}>
      <div className="bg-surface-container-lowest border border-border-subtle rounded p-md inner-glow flex justify-between items-center gap-sm mb-md">
        <span className="font-mono-data text-mono-data text-text-muted uppercase min-w-0">{t('screens.cards.lifetimeCashback')}</span>
        <span className="font-mono-data text-[15px] text-tertiary whitespace-nowrap shrink-0">+{fmt(cashback)}</span>
      </div>

      {payments.length === 0 ? (
        <div className="py-[40px] flex flex-col items-center text-center gap-sm">
          <MS name="payments" className="text-[32px] text-text-muted" />
          <p className="font-body-md text-body-md text-on-surface-variant">{t('screens.cards.noPaymentsYet')}</p>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-border-subtle">
          {payments.map((p) => (
            <div key={p.id} className="flex items-center justify-between py-sm group">
              <div className="flex flex-col min-w-0">
                <span className="font-mono-data text-[14px] text-on-surface">{fmt(p.amount)}</span>
                <span className="font-mono-data text-mono-data text-text-muted">{formatDate(p.date)}{p.note ? ` · ${p.note}` : ''}</span>
              </div>
              <button onClick={() => onDelete(p)} className="text-text-muted hover:text-accent-error p-xs tap-target hover-reveal" aria-label={t('screens.cards.deletePayment')}>
                <MS name="delete" className="!text-[16px]" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
