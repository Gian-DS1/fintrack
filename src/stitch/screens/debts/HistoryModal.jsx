// Historial de pagos de una deuda: resumen (total pagado + proyección de payoff)
// y lista de pagos con borrar + Deshacer. El borrado revierte saldo y la
// transacción enlazada (vía deletePayment del store).
import toast from 'react-hot-toast';
import { toastUndo } from '../../toastUndo';
import MS from '../../MS';
import useDebtStore from '../../../stores/useDebtStore';
import { formatCurrency, formatDate, toISODate } from '../../../utils/formatters';
import { useI18n } from '../../../contexts/I18nContext';
import { tr } from '../../../i18n/runtime';
import { getPayoff } from './payoff';
import { Modal } from '../../formUi';

const fmt = (n, c) => formatCurrency(n, c);

export default function HistoryModal({ debt: debtProp, onClose }) {
  const { t } = useI18n();
  const { debts, payments, addPayment, deletePayment, restorePayment } = useDebtStore();

  // Lee la deuda VIVA del store (su saldo cambia al borrar pagos dentro del modal).
  const debt = debts.find((d) => d.id === debtProp.id) || debtProp;

  const list = payments
    .filter((p) => p.debtId === debt.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const totalPaid = list.reduce((s, p) => s + Number(p.amount), 0);
  const payoff = getPayoff(debt);

  const onDelete = async (p) => {
    const res = await deletePayment(p.id);
    if (!res?.ok) return;
    if (res.hadTransactionLink === false) toast(tr('screens.debts.balanceRevertedNoLink'), { duration: 5000 });
    toastUndo(tr('screens.debts.paymentDeleted'), () => {
      if (restorePayment) restorePayment(p); else addPayment(p.debtId, p.amount, p.date, p.notes || '');
    });
  };

  return (
    <Modal title={`${t('screens.debts.paymentsTitle')} · ${debt.creditorName}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-sm mb-md">
        <div className="bg-surface-container-lowest border border-border-subtle rounded p-md inner-glow flex flex-col">
          <span className="font-mono-data text-mono-data text-text-muted uppercase">{t('screens.debts.totalPaid')}</span>
          <span className="font-mono-data text-[15px] text-on-surface mt-1">{fmt(totalPaid, debt.currency)}</span>
        </div>
        <div className="bg-surface-container-lowest border border-border-subtle rounded p-md inner-glow flex flex-col">
          <span className="font-mono-data text-mono-data text-text-muted uppercase">{t('screens.debts.currentBalance')}</span>
          <span className="font-mono-data text-[15px] text-on-surface mt-1">{fmt(debt.currentBalance, debt.currency)}</span>
        </div>
      </div>

      {payoff.coversInterest ? (
        <p className="font-mono-data text-mono-data text-text-muted normal-case tracking-normal mb-md">
          {t('screens.debts.atThisPaceFree')} <span className="text-tertiary">{payoff.months} {payoff.months === 1 ? t('screens.vaults.month') : t('dashboard.months')}</span> ({formatDate(toISODate(payoff.payoffDate))}) · {t('screens.debts.totalInterestsInline')} {fmt(payoff.totalInterest, debt.currency)}.
        </p>
      ) : (
        <p className="font-mono-data text-mono-data text-accent-warning normal-case tracking-normal mb-md">{t('screens.debts.paymentNotCovering')}</p>
      )}

      {list.length === 0 ? (
        <div className="py-[40px] flex flex-col items-center text-center gap-sm">
          <MS name="payments" className="text-[32px] text-text-muted" />
          <p className="font-body-md text-body-md text-on-surface-variant">{t('screens.debts.noPaymentsYet')}</p>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-border-subtle">
          {list.map((p) => (
            <div key={p.id} className="flex items-center justify-between py-sm group">
              <div className="flex flex-col min-w-0">
                <span className="font-mono-data text-[14px] text-on-surface">{fmt(p.amount, debt.currency)}</span>
                <span className="font-mono-data text-mono-data text-text-muted">{formatDate(p.date)}{p.notes ? ` · ${p.notes}` : ''}</span>
              </div>
              <button onClick={() => onDelete(p)} className="text-text-muted hover:text-accent-error p-xs tap-target hover-reveal" aria-label={t('screens.debts.deletePayment')}>
                <MS name="delete" className="!text-[16px]" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
