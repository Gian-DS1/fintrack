// Ahorros (Vaults) — shell: header (ahorro total) + grid de metas + modales. La
// lógica de aportes (con transacción enlazada) vive en useSavingsStore; la
// proyección en vaults/projection.js. Patrón espejo de Deudas.
import { useState } from 'react';
import { toastUndo } from '../toastUndo';
import MS from '../MS';
import { Stagger } from '../StitchMotion';
import StitchSelect from '../StitchSelect';
import useSavingsStore from '../../stores/useSavingsStore';
import { getHorizonFilterOptions } from './vaults/horizons';
import { useI18n } from '../../contexts/I18nContext';
import { tr } from '../../i18n/runtime';
import VaultItem from './vaults/VaultItem';
import VaultForm from './vaults/VaultForm';
import ContributionModal from './vaults/ContributionModal';
import HistoryModal from './vaults/HistoryModal';

export default function StitchVaults() {
  const { t } = useI18n();
  const { goals, contributions, deleteGoal, restoreGoalWithContributions } = useSavingsStore();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [contribGoal, setContribGoal] = useState(null);
  const [historyGoal, setHistoryGoal] = useState(null);
  const [horizonFilter, setHorizonFilter] = useState('');

  const visibleGoals = goals.filter((g) => {
    if (!horizonFilter) return true;
    if (horizonFilter === 'none') return !g.horizon;
    return g.horizon === horizonFilter;
  });

  const openCreate = () => { setEditing(null); setShowForm(true); };
  const openEdit = (g) => { setEditing(g); setShowForm(true); };

  const onDelete = async (goal) => {
    // Captura los aportes antes de borrar para restaurarlos en el Deshacer.
    const goalContribs = contributions.filter((c) => c.goalId === goal.id);
    await deleteGoal(goal.id);
    toastUndo(tr('screens.vaults.goalDeleted'), async () => {
      await restoreGoalWithContributions(goal, goalContribs);
    });
  };

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-lg mb-xl">
        <div>
          <div className="flex items-center gap-2 mb-sm">
            <span className="w-2 h-2 rounded-full bg-tertiary live-dot" />
            <span className="font-mono-data text-mono-data text-tertiary uppercase tracking-wider">{t('common.activeSystem')}</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface">{t('landing.features.savings')}</h1>
        </div>
        <div className="flex items-center gap-sm self-start">
          {goals.length > 0 && (
            <div className="w-[180px]">
              <StitchSelect value={horizonFilter} onChange={setHorizonFilter} options={getHorizonFilterOptions()} compact />
            </div>
          )}
          <button data-tour="vaults-new" onClick={openCreate} className="bg-primary text-on-primary font-label-sm text-label-sm uppercase tracking-widest font-bold px-md py-sm rounded hover:bg-primary-container transition-colors inner-glow flex items-center gap-xs">
            <MS name="add" className="text-[16px]" /> {t('common.newGoal')}
          </button>
        </div>
      </div>

      {goals.length === 0 ? (
        <div className="bg-surface-card border border-border-subtle rounded-lg inner-glow py-[60px] flex flex-col items-center gap-sm text-center">
          <MS name="savings" className="text-[36px] text-text-muted" />
          <p className="font-body-md text-body-md text-on-surface-variant">{t('screens.vaults.noGoalsYet')}</p>
          <button onClick={openCreate} className="mt-sm bg-primary text-on-primary font-label-sm text-label-sm uppercase tracking-widest px-md py-sm rounded">{t('screens.vaults.createFirstGoal')}</button>
        </div>
      ) : visibleGoals.length === 0 ? (
        <div className="bg-surface-card border border-border-subtle rounded-lg inner-glow py-[40px] flex flex-col items-center gap-sm text-center">
          <MS name="filter_alt_off" className="text-[28px] text-text-muted" />
          <p className="font-body-md text-body-md text-on-surface-variant">{t('screens.vaults.noneInHorizon')}</p>
        </div>
      ) : (
        <Stagger className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-md">
          {visibleGoals.map((g) => (
            <VaultItem key={g.id} goal={g} onContribute={setContribGoal} onHistory={setHistoryGoal} onEdit={openEdit} onDelete={onDelete} />
          ))}
        </Stagger>
      )}

      {showForm && <VaultForm editing={editing} onClose={() => setShowForm(false)} />}
      {contribGoal && <ContributionModal goal={contribGoal} onClose={() => setContribGoal(null)} />}
      {historyGoal && <HistoryModal goal={historyGoal} onClose={() => setHistoryGoal(null)} />}
    </div>
  );
}
