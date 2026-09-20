// Historial de aportes de una meta: resumen (total aportado + proyección) y lista
// con borrar + Deshacer. El borrado revierte saldo y la transacción enlazada.
import { toastUndo } from '../../toastUndo';
import MS from '../../MS';
import Emoji from '../../Emoji';
import useSavingsStore from '../../../stores/useSavingsStore';
import { formatCurrency, formatDate, toISODate } from '../../../utils/formatters';
import { useI18n } from '../../../contexts/I18nContext';
import { tr } from '../../../i18n/runtime';
import { getProjection } from './projection';
import { Modal } from '../../formUi';

const fmt = (n, c) => formatCurrency(n, c);

export default function HistoryModal({ goal: goalProp, onClose }) {
  const { t } = useI18n();
  const { goals, contributions, addContribution, deleteContribution, restoreContribution } = useSavingsStore();

  // Lee la meta VIVA del store (su saldo cambia al borrar aportes dentro del modal).
  const goal = goals.find((g) => g.id === goalProp.id) || goalProp;

  const list = contributions
    .filter((c) => c.goalId === goal.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const totalContributed = list.reduce((s, c) => s + Number(c.amount), 0);
  const proj = getProjection(goal);

  const onDelete = async (c) => {
    // A diferencia de Deudas, no avisamos por hadTransactionLink: todo aporte
    // nace con su transacción enlazada (no hay filas legadas sin enlace).
    const res = await deleteContribution(c.id);
    if (!res?.ok) return;
    toastUndo(tr('screens.vaults.contributionDeleted'), () => {
      if (restoreContribution) restoreContribution(c); else addContribution(c.goalId, c.amount, c.date, c.notes || '');
    });
  };

  return (
    <Modal title={`${t('screens.vaults.contributionsTitle')} · ${goal.title}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-sm mb-md">
        <div className="bg-surface-container-lowest border border-border-subtle rounded p-md inner-glow flex flex-col">
          <span className="font-mono-data text-mono-data text-text-muted uppercase">{t('screens.vaults.totalContributed')}</span>
          <span className="font-mono-data text-[15px] text-on-surface mt-1">{fmt(totalContributed, goal.currency)}</span>
        </div>
        <div className="bg-surface-container-lowest border border-border-subtle rounded p-md inner-glow flex flex-col">
          <span className="font-mono-data text-mono-data text-text-muted uppercase">{t('screens.vaults.currentBalance')}</span>
          <span className="font-mono-data text-[15px] text-on-surface mt-1">{fmt(goal.currentAmount, goal.currency)}</span>
        </div>
      </div>

      {proj.done ? (
        <p className="font-mono-data text-mono-data text-tertiary normal-case tracking-normal mb-md inline-flex items-center gap-xs">{t('screens.status.completedGoal')}. <Emoji e="🎉" size={14} /></p>
      ) : proj.reachable ? (
        <p className="font-mono-data text-mono-data text-text-muted normal-case tracking-normal mb-md">
          {t('screens.vaults.atThisPace')} <span className="text-tertiary">{proj.months} {proj.months === 1 ? t('screens.vaults.month') : t('dashboard.months')}</span>{proj.projectedDate ? ` (${formatDate(toISODate(proj.projectedDate))})` : ''}.
        </p>
      ) : (
        <p className="font-mono-data text-mono-data text-text-muted normal-case tracking-normal mb-md">{t('screens.vaults.defineMonthlyInGoal')}</p>
      )}

      {list.length === 0 ? (
        <div className="py-[40px] flex flex-col items-center text-center gap-sm">
          <MS name="savings" className="text-[32px] text-text-muted" />
          <p className="font-body-md text-body-md text-on-surface-variant">{t('screens.vaults.noContributionsYet')}</p>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-border-subtle">
          {list.map((c) => (
            <div key={c.id} className="flex items-center justify-between py-sm group">
              <div className="flex flex-col min-w-0">
                <span className="font-mono-data text-[14px] text-on-surface">{fmt(c.amount, goal.currency)}</span>
                <span className="font-mono-data text-mono-data text-text-muted">{formatDate(c.date)}{c.notes ? ` · ${c.notes}` : ''}</span>
              </div>
              <button onClick={() => onDelete(c)} className="text-text-muted hover:text-accent-error p-xs tap-target hover-reveal" aria-label={t('screens.vaults.deleteContribution')}>
                <MS name="delete" className="!text-[16px]" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
