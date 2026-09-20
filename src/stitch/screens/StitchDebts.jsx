// Deudas — shell: header (deuda total) + grid avalancha + modales. La lógica de
// pagos (con transacción enlazada) vive en el store; el payoff en debts/payoff.js.
import { useMemo, useState } from 'react';
import { toastUndo } from '../toastUndo';
import MS from '../MS';
import { Stagger } from '../StitchMotion';
import CountUp from '../CountUp';
import useDebtStore from '../../stores/useDebtStore';
import { isDemoActive, demoDeleteDebt, demoRestoreDebt } from '../demoMode';
import { useI18n } from '../../contexts/I18nContext';
import { tr } from '../../i18n/runtime';
import { formatCurrency } from '../../utils/formatters';
import DebtItem from './debts/DebtItem';
import DebtForm from './debts/DebtForm';
import PaymentModal from './debts/PaymentModal';
import HistoryModal from './debts/HistoryModal';

const fmt = (n) => formatCurrency(n);

export default function StitchDebts({ embedded = false }) {
  const { t } = useI18n();
  const { debts, payments, addDebt, deleteDebt, restorePayment } = useDebtStore();
  const getTotalDebt = useDebtStore((s) => s.getTotalDebt);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [payDebt, setPayDebt] = useState(null);
  const [historyDebt, setHistoryDebt] = useState(null);

  // Estrategia avalancha: ordena por mayor interés (paga primero el más caro).
  const ordered = useMemo(
    () => debts.filter((d) => d.status === 'active').sort((a, b) => Number(b.interestRate) - Number(a.interestRate)),
    [debts],
  );
  const totalDebt = getTotalDebt();

  const openCreate = () => { setEditing(null); setShowForm(true); };
  const openEdit = (d) => { setEditing(d); setShowForm(true); };

  const onDelete = async (debt) => {
    // Capturar los pagos antes de borrar para poder restaurar todo en Deshacer.
    const debtPayments = payments.filter((p) => p.debtId === debt.id);
    if (isDemoActive()) demoDeleteDebt(debt.id); else await deleteDebt(debt.id);
    toastUndo(tr('screens.debts.debtDeleted'), async () => {
      if (isDemoActive()) {
        demoRestoreDebt(debt, debtPayments);
      } else {
        await addDebt(debt);
        // Re-aplica los pagos (recrea sus transacciones enlazadas).
        for (const p of debtPayments) await restorePayment(p);
      }
    });
  };

  return (
    <div className={embedded ? '' : 'p-md sm:p-margin-safe max-w-[1728px] mx-auto w-full'}>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-lg mb-xl">
        <div>
          <div className="flex items-center gap-sm mb-xs">
            <span className="w-2 h-2 rounded-full bg-accent-error error-dot" />
            <span className="font-mono-data text-mono-data text-accent-error uppercase tracking-wider">{t('screens.debts.liabilitiesAvalanche')}</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface">{t('screens.debts.debtControl')}</h1>
          {!embedded && <p className="font-body-md text-body-md text-text-muted mt-sm">{t('screens.debts.totalActiveDebt')} <span className="text-accent-error font-mono-data"><CountUp value={totalDebt} format={fmt} /></span></p>}
        </div>
        <button data-tour="debts-new" onClick={openCreate} className="bg-primary text-on-primary font-label-sm text-label-sm uppercase tracking-widest font-bold px-md py-sm rounded hover:bg-primary-container transition-colors inner-glow flex items-center gap-xs self-start">
          <MS name="add" className="text-[16px]" /> {t('common.newDebt')}
        </button>
      </div>

      {ordered.length === 0 ? (
        <div className="bg-surface-card border border-border-subtle rounded-lg inner-glow py-[60px] flex flex-col items-center gap-sm text-center">
          <MS name="celebration" className="text-[36px] text-tertiary" />
          <p className="font-body-md text-body-md text-on-surface-variant">{t('screens.debts.noActiveDebts')}</p>
          <button onClick={openCreate} className="mt-sm bg-primary text-on-primary font-label-sm text-label-sm uppercase tracking-widest px-md py-sm rounded">{t('screens.debts.registerDebt')}</button>
        </div>
      ) : (
        <Stagger className="grid grid-cols-1 lg:grid-cols-3 gap-md">
          {ordered.map((d, i) => (
            <DebtItem key={d.id} debt={d} index={i} onPay={setPayDebt} onHistory={setHistoryDebt} onEdit={openEdit} onDelete={onDelete} />
          ))}
        </Stagger>
      )}

      {showForm && <DebtForm editing={editing} onClose={() => setShowForm(false)} />}
      {payDebt && <PaymentModal debt={payDebt} onClose={() => setPayDebt(null)} />}
      {historyDebt && <HistoryModal debt={historyDebt} onClose={() => setHistoryDebt(null)} />}
    </div>
  );
}
