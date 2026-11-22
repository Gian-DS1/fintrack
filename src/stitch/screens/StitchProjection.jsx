// Proyección a 12 meses — simulación del dinero real al cierre de cada mes.
// Pantalla de SOLO LECTURA sobre los datos: la lógica vive en
// utils/cashflowProjection.js (projectRealMoney, funciones puras) y aquí solo se
// muestra. Lo que el usuario cambia (escenario, recorte, categorías esenciales,
// interruptores, gasto base manual) se guarda únicamente en el dispositivo
// (projection/simulationStorage.js): nada de esto escribe en stores ni en Supabase.
import { useMemo } from 'react';
import MS from '../MS';
import { Stagger } from '../StitchMotion';
import { InfoTip } from '../InfoTip';
import { useI18n } from '../../contexts/I18nContext';
import { useAuth } from '../../contexts/AuthContext';
import { isDemoActive } from '../demoMode';
import useTransactionStore from '../../stores/useTransactionStore';
import useCategoryStore from '../../stores/useCategoryStore';
import useDebtStore from '../../stores/useDebtStore';
import useCreditCardStore from '../../stores/useCreditCardStore';
import useRecurringStore from '../../stores/useRecurringStore';
import usePrefsStore from '../../stores/usePrefsStore';
import { getCurrency } from '../../utils/currencyRuntime';
import { projectRealMoney, monthlyEquivalent } from '../../utils/cashflowProjection';
import { formatCurrencyWhole } from '../../utils/formatters';
import { monthName } from '../../i18n/runtime';
import { BentoCell } from './dashboard/dashboardUi';
import useSimulation from './projection/useSimulation';
import ScenarioControls from './projection/ScenarioControls';
import ProjectionChart from './projection/ProjectionChart';
import ProjectionTable from './projection/ProjectionTable';
import BaseSpendPanel from './projection/BaseSpendPanel';
import CancellationPanel from './projection/CancellationPanel';
import SwitchControl from './projection/SwitchControl';
import { getDebtPaymentCategoryIds } from './projection/debtCategories';

const fmt = (n) => formatCurrencyWhole(n);
const EXPENSE_LIKE = ['expense', 'fixed_expense', 'variable_expense', 'savings'];

export default function StitchProjection() {
  const { t } = useI18n();
  const transactions = useTransactionStore((s) => s.transactions);
  const categories = useCategoryStore((s) => s.categories);
  const debts = useDebtStore((s) => s.debts);
  const debtPayments = useDebtStore((s) => s.payments);
  const cards = useCreditCardStore((s) => s.cards);
  const recurring = useRecurringStore((s) => s.recurring);
  const initialCashBalance = usePrefsStore((s) => s.initialCashBalance);
  const profileCurrency = usePrefsStore((s) => s.currency);

  const now = useMemo(() => new Date(), []);
  const { user } = useAuth();
  // La simulación se guarda por usuario en el dispositivo (en demo, 'demo').
  const { simulation, update } = useSimulation(isDemoActive() ? 'demo' : user?.id);

  // Pagos de préstamo antiguos sin enlace a su transacción: se reconocen por categoría.
  const debtPaymentCategoryIds = useMemo(
    () => getDebtPaymentCategoryIds(categories, debts),
    [categories, debts],
  );

  const result = useMemo(() => projectRealMoney({
    transactions, initialCashBalance, cards, recurring, debts, debtPayments,
    currency: profileCurrency || getCurrency(), refDate: now,
    scenario: simulation.scenario,
    excludedRecurringIds: simulation.excludedRecurringIds,
    variableOverride: simulation.variableOverride,
    essentialCategoryIds: simulation.essentialCategoryIds,
    cutPct: simulation.cutPct,
    includeFixedUnscheduled: simulation.includeFixedUnscheduled,
    debtPaymentCategoryIds,
  }), [transactions, initialCashBalance, cards, recurring, debts, debtPayments, profileCurrency, now, simulation, debtPaymentCategoryIds]);

  const variableCategories = useMemo(
    () => categories.filter((c) => c.type === 'variable_expense' && c.isActive !== false),
    [categories],
  );

  // Recurrentes activos para los interruptores, de mayor a menor peso mensual.
  const toItem = (r, fallbackKey) => ({
    id: r.id, name: r.description || t(fallbackKey), monthly: monthlyEquivalent(r), isIncome: r.type === 'income',
  });
  const byWeight = (a, b) => b.monthly - a.monthly;
  const active = recurring.filter((r) => r.active);
  const expenseItems = active
    .filter((r) => EXPENSE_LIKE.includes(r.type))
    .map((r) => toItem(r, r.type === 'savings' ? 'dashboard.cashflowSavings' : 'dashboard.cashflowExpense'))
    .sort(byWeight);
  const incomeItems = active
    .filter((r) => r.type === 'income')
    .map((r) => toItem(r, 'dashboard.cashflowIncome'))
    .sort(byWeight);

  const toggleExcluded = (id) => {
    const ids = simulation.excludedRecurringIds;
    update({ excludedRecurringIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] });
  };

  const last = result.points[result.points.length - 1];
  const crossing = result.firstNegativeKey ? result.points.find((p) => p.key === result.firstNegativeKey) : null;
  const alreadyNegative = result.start < 0;
  const verdictBad = alreadyNegative || !!crossing;
  let verdict;
  if (alreadyNegative) verdict = t('projection.alreadyNegative').replace('{amount}', fmt(last.realMoney));
  else if (crossing) verdict = t('projection.crossesNegative').replace('{month}', `${monthName(crossing.m)} ${crossing.y}`);
  else verdict = t('projection.endsAt').replace('{amount}', fmt(last.realMoney));

  return (
    <div className="p-sm sm:p-md max-w-[1728px] mx-auto w-full">
      <div className="mb-md">
        <h1 className="font-headline-lg text-headline-lg text-on-surface">{t('projection.title')}</h1>
        <p className="font-body-md text-body-md text-text-muted mt-xs">{t('projection.subtitle')}</p>
      </div>

      {/* Cabecera fija: recuerda en todo momento que esto es una simulación. */}
      <div role="note" className="flex items-start gap-sm mb-md px-md py-sm rounded bg-primary/10 border border-primary/30">
        <MS name="science" className="!text-[16px] text-primary shrink-0 mt-[2px]" />
        <span className="font-label-sm text-label-sm text-on-surface">{t('projection.simulationBanner')}</span>
      </div>

      <Stagger className="grid grid-cols-1 md:grid-cols-12 gap-sm auto-rows-min">
        <Stagger.Item className="md:col-span-12">
          <BentoCell className="h-full">
            <div className="flex items-center justify-between gap-sm border-b border-border-subtle pb-sm mb-sm">
              <span className="font-mono-data text-mono-data text-on-surface-variant uppercase flex items-center gap-xs min-w-0">
                <MS name="insights" className="!text-[14px] text-text-muted shrink-0" />
                <span className="break-words min-w-0">{t('projection.chartTitle')}</span>
              </span>
              <span className="shrink-0 inline-flex items-center gap-[3px] px-sm py-[2px] rounded-full border border-border-subtle font-mono-data text-mono-data text-text-muted uppercase">
                {t('projection.estimateTag')}
                <InfoTip text={t('projection.assumptionsNote')} />
              </span>
            </div>

            <ScenarioControls simulation={simulation} onChange={update} categories={variableCategories} />

            <p
              aria-live="polite"
              className={`mt-md flex items-start gap-xs font-body-md text-body-md ${verdictBad ? 'text-accent-error' : 'text-on-surface'}`}
            >
              {verdictBad && <MS name="warning" fill className="!text-[16px] shrink-0 mt-[2px]" />}
              <span>{verdict}</span>
            </p>

            {!result.hasRecurringIncome && (
              <p className="mt-xs flex items-start gap-xs font-label-sm text-label-sm text-accent-warning">
                <MS name="info" className="!text-[14px] shrink-0 mt-[1px]" />
                <span>{t('projection.noRecurringIncome')}</span>
              </p>
            )}

            <div className="mt-md">
              <ProjectionChart start={result.start} points={result.points} firstNegativeKey={result.firstNegativeKey} />
            </div>
            <ProjectionTable start={result.start} points={result.points} />
          </BentoCell>
        </Stagger.Item>

        <Stagger.Item className="md:col-span-6">
          <BentoCell className="h-full">
            <div className="flex flex-col gap-md">
              <BaseSpendPanel
                base={result.base}
                override={simulation.variableOverride}
                scenario={simulation.scenario}
                onChange={(value) => update({ variableOverride: value })}
              />
              <div className="border-t border-border-subtle pt-sm flex flex-col gap-xs">
                <h3 className="font-mono-data text-mono-data text-on-surface-variant uppercase">{t('projection.assumptionsTitle')}</h3>
                <p className="font-label-sm text-label-sm text-on-surface-variant">{t('projection.assumptionsNote')}</p>
                {result.base.fixedUnscheduled > 0 && (
                  <label className="flex items-start gap-sm py-xs cursor-pointer">
                    <SwitchControl
                      checked={simulation.includeFixedUnscheduled}
                      onChange={(e) => update({ includeFixedUnscheduled: e.target.checked })}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-body-md text-body-md text-on-surface">{t('projection.fixedInclude')}</span>
                      <span className="block font-label-sm text-label-sm text-on-surface-variant">
                        {t('projection.fixedUnscheduled').replace('{amount}', fmt(result.base.fixedUnscheduled))}
                      </span>
                    </span>
                  </label>
                )}
                <p className="font-label-sm text-label-sm text-on-surface-variant">{t('projection.loansNote')}</p>
                {result.skippedDebts.length > 0 && (
                  <p className="font-label-sm text-label-sm text-text-muted">
                    {t('projection.skippedDebts').replace('{n}', result.skippedDebts.length)}
                  </p>
                )}
              </div>
            </div>
          </BentoCell>
        </Stagger.Item>

        <Stagger.Item className="md:col-span-6">
          <BentoCell className="h-full">
            <CancellationPanel
              expenses={expenseItems}
              incomes={incomeItems}
              excludedIds={simulation.excludedRecurringIds}
              onToggle={toggleExcluded}
            />
          </BentoCell>
        </Stagger.Item>
      </Stagger>
    </div>
  );
}
