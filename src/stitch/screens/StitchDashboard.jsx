// Resumen (Dashboard) — bento grid ordenado por importancia. Datos reales; la
// lógica pura vive en dashboard/selectors.js y utils/calculations. Solo lectura.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MS from '../MS';
import { Stagger } from '../StitchMotion';
import { useI18n } from '../../contexts/I18nContext';
import useTransactionStore from '../../stores/useTransactionStore';
import useSavingsStore from '../../stores/useSavingsStore';
import useDebtStore from '../../stores/useDebtStore';
import useCategoryStore from '../../stores/useCategoryStore';
import useBudgetStore from '../../stores/useBudgetStore';
import useCreditCardStore from '../../stores/useCreditCardStore';
import { getBudgetSummary } from '../../utils/calculations';
import { getNextLoanDueDate } from '../../utils/loanReminders';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { monthShort } from '../../i18n/runtime';
import { getCategoryBreakdown, getBudgetUsage, getBudgetPace, getWealthTimeline, getCardReminders } from './dashboard/selectors';
import { BentoCell } from './dashboard/dashboardUi';
import WealthTrendChart from './dashboard/WealthTrendChart';
import CategoryDonut from './dashboard/CategoryDonut';
import BudgetBar from './dashboard/BudgetBar';
import SignalsRail from './dashboard/SignalsRail';
import usePrefsStore from '../../stores/usePrefsStore';
import { isDemoActive } from '../demoMode';

const fmt = (n) => formatCurrency(n);

export default function StitchDashboard() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const transactions = useTransactionStore((s) => s.transactions);
  const categories = useCategoryStore((s) => s.categories);
  const getTotalMonthlyPayment = useDebtStore((s) => s.getTotalMonthlyPayment);
  const budgets = useBudgetStore((s) => s.budgets);
  const payments = useDebtStore((s) => s.payments);
  const debts = useDebtStore((s) => s.debts);
  const cards = useCreditCardStore((s) => s.cards);
  const goals = useSavingsStore((s) => s.goals);

  const now = useMemo(() => new Date(), []);

  // Mes seleccionado (estado). Inicia en el mes actual; el selector permite
  // revisar meses pasados. Solo afecta las métricas MENSUALES; patrimonio,
  // tarjetas y recordatorios siguen siendo de hoy.
  const [sel, setSel] = useState(() => ({ y: now.getFullYear(), m: now.getMonth() }));
  const y = sel.y;
  const m = sel.m;
  const isCurrentMonth = sel.y === now.getFullYear() && sel.m === now.getMonth();

  const monthTx = useMemo(
    () => transactions.filter((t) => {
      const d = new Date(t.date + 'T00:00:00');
      return d.getFullYear() === y && d.getMonth() === m;
    }),
    [transactions, y, m],
  );

  const monthBudgets = useMemo(() => budgets.filter((b) => b.year === y && b.month === m), [budgets, y, m]);

  const debtPaidThisMonth = useMemo(() => payments.reduce((sum, p) => {
    const d = new Date(p.date + 'T00:00:00');
    if (d.getFullYear() !== y || d.getMonth() !== m) return sum;
    return sum + (Number(p.amount) || 0);
  }, 0), [payments, y, m]);

  const summary = useMemo(() => getBudgetSummary({
    monthTransactions: monthTx, monthBudgets, categories,
    debtPlanned: getTotalMonthlyPayment(), debtPaid: debtPaidThisMonth,
  }), [monthTx, monthBudgets, categories, getTotalMonthlyPayment, debtPaidThisMonth]);

  // Donut de gastos
  const breakdown = useMemo(() => getCategoryBreakdown(monthTx, categories), [monthTx, categories]);

  // Efectivo líquido (solo demo): saldo derivado para el modal "Apartar a ahorro".
  // Los gastos con tarjeta NO restan del efectivo; los pagos de tarjeta sí.
  const demo = isDemoActive();
  const initialCashBalance = usePrefsStore((s) => s.initialCashBalance);

  // Rango del gráfico de tendencia: 3 meses / 1 año / todo el tiempo. Siempre
  // termina en el mes actual (now) y arranca a lo sumo en la primera transacción.
  const [wealthRange, setWealthRange] = useState(3);
  // Punto del tiempo FIJADO con click en la línea (key 'YYYY-MM-DD' o 'YYYY-MM').
  // null = sin selección (el hero muestra hoy). Al fijar, también se selecciona
  // el MES del punto para que TODO el dashboard (flujo, donut, presupuesto)
  // quede congelado en ese momento; re-click en el mismo punto libera y vuelve
  // al mes actual.
  const [selKey, setSelKey] = useState(null);
  const handleSelectPoint = (p) => {
    if (selKey === p.key) {
      setSelKey(null);
      setSel({ y: now.getFullYear(), m: now.getMonth() });
    } else {
      setSelKey(p.key);
      setSel({ y: p.y, m: p.m });
    }
  };
  // Ahorro REAL de hoy = Σ del monto actual de cada meta (incluye el saldo previo
  // que ya tenían las metas, no solo los aportes registrados). El selector lo usa
  // para que el "Ahorro total" del gráfico cuadre con la pestaña de Ahorros.
  const currentSavings = useMemo(() => goals.reduce((sum, g) => sum + (Number(g.currentAmount) || 0), 0), [goals]);
  const wealthSeries = useMemo(
    () => getWealthTimeline(transactions, initialCashBalance, wealthRange, now, cards, currentSavings),
    [transactions, initialCashBalance, wealthRange, now, cards, currentSavings],
  );
  // Pills segmentadas del rango (3M · 1A · Todo): menos taps que un dropdown y
  // liberan el encabezado. El aria-label conserva el nombre completo.
  const rangeOptions = [
    { value: 3, label: t('dashboard.range3Short'), full: t('dashboard.range3') },
    { value: 12, label: t('dashboard.range12Short'), full: t('dashboard.range12') },
    { value: 'all', label: t('dashboard.rangeAllShort'), full: t('dashboard.rangeAll') },
  ];

  // Presupuesto usado + ritmo del mes en curso (tick y veredicto de BudgetBar)
  const budgetUsage = useMemo(() => getBudgetUsage(summary), [summary]);
  const budgetPace = useMemo(() => getBudgetPace(budgetUsage, {
    isCurrentMonth,
    dayOfMonth: now.getDate(),
    daysInMonth: new Date(y, m + 1, 0).getDate(),
  }), [budgetUsage, isCurrentMonth, now, y, m]);

  // Recordatorios (siempre de HOY, no del mes seleccionado).
  const signals = useMemo(() => {
    const out = [];
    const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    getCardReminders(cards, transactions, now).forEach(({ cardName, amount, dueDateISO, days }) => {
      out.push({ days, tag: t('dashboard.cardToPay'), tc: days <= 2 ? 'text-accent-error' : 'text-accent-warning', t: days === 0 ? t('calendar.today').toUpperCase() : t('dashboard.inDays').replace('{d}', days), body: `${cardName}: ${fmt(amount)} ${t('dashboard.dueOn')} ${formatDate(dueDateISO)}.`, to: '/tarjetas' });
    });
    debts.filter((d) => d.status === 'active' && d.due_date).forEach((d) => {
      // Próxima fecha de pago pendiente (avanza al mes siguiente si la de este mes ya se pagó).
      const nextDueISO = getNextLoanDueDate(d, payments, now);
      if (!nextDueISO) return;
      const due = new Date(nextDueISO + 'T00:00:00');
      const days = Math.round((due - todayMid) / 86400000);
      if (days < 0 || days > 14) return;
      out.push({ days, tag: t('dashboard.debtInstallment'), tc: 'text-accent-error', t: days === 0 ? t('calendar.today').toUpperCase() : t('dashboard.inDays').replace('{d}', days), body: `${d.creditorName}: ${fmt(Number(d.monthlyPayment))} ${t('dashboard.dueOn')} ${formatDate(nextDueISO)}.`, to: '/deudas' });
    });
    goals.filter((g) => g.status !== 'completed' && g.deadline).forEach((g) => {
      const due = new Date(g.deadline + 'T00:00:00');
      const days = Math.ceil((due - todayMid) / 86400000);
      if (days < 0 || days > 30) return;
      out.push({ days, tag: t('dashboard.goalUpcoming'), tc: 'text-secondary', t: t('dashboard.inDays').replace('{d}', days), body: `"${g.title}" ${t('dashboard.dueOn')} ${formatDate(g.deadline)}.`, to: '/ahorros' });
    });
    // Orden ascendente por vencimiento: lo que se paga ANTES va primero, para
    // que el usuario sepa de un vistazo a qué darle prioridad (una tarjeta a 2
    // días pesa más que un préstamo a 10). Empates → desempata por urgencia de
    // color (rojo antes que ámbar/secundario).
    const urgency = { 'text-accent-error': 0, 'text-accent-warning': 1, 'text-secondary': 2 };
    return out
      .sort((a, b) => a.days - b.days || (urgency[a.tc] ?? 3) - (urgency[b.tc] ?? 3))
      .slice(0, 6);
  }, [cards, debts, goals, transactions, payments, now, t]);

  return (
    <div className="p-sm sm:p-md max-w-[1728px] mx-auto w-full">
      {/* Título de página para lectores de pantalla (el bento no tiene header visible). */}
      <h1 className="sr-only">{t('nav.dashboard')}</h1>

      {/* Aviso (solo demo): efectivo inicial sin declarar. */}
      {demo && initialCashBalance === 0 && (
        <div className="flex items-center gap-sm mb-md px-md py-sm rounded bg-primary/10 border border-primary/30">
          <MS name="info" className="!text-[16px] text-primary" />
          <span className="font-label-sm text-label-sm text-on-surface-variant">{t('dashboard.declareInitialCash')}</span>
          <button onClick={() => navigate('/ajustes')} className="ml-auto font-mono-data text-mono-data text-primary hover:underline">{t('nav.settings')}</button>
        </div>
      )}

      <Stagger data-tour="dashboard-grid" className="grid grid-cols-2 md:grid-cols-12 gap-sm auto-rows-min">
        {/* 1 · HERO a TODO EL ANCHO (col-12): el gráfico del patrimonio es el
            protagonista y ocupa toda la página (estilo Whisper). Jerarquía:
            título → hero (número + toggle) + gráfico grande → pills de rango →
            barra de presupuesto al pie. Debajo, en su propia fila, las tarjetas
            de apoyo (donut, salud, recordatorios). */}
        <Stagger.Item className="col-span-2 md:col-span-12">
          <BentoCell className="h-full">
            <div className="flex justify-between items-center border-b border-border-subtle pb-sm mb-sm gap-sm">
              <span className="font-mono-data text-mono-data text-on-surface-variant uppercase flex items-center gap-xs min-w-0">
                <MS name="show_chart" className="!text-[14px] text-text-muted shrink-0" />
                <span className="break-words min-w-0">{t('dashboard.monthFlow')}</span>
                <span className="text-primary shrink-0">· {monthShort(m)} {y}</span>
              </span>
            </div>
            <WealthTrendChart
              data={wealthSeries}
              selectedKey={selKey}
              onSelect={handleSelectPoint}
            />
            <div className="flex justify-center gap-xs mt-sm">
              {rangeOptions.map((r) => (
                <button
                  key={String(r.value)}
                  type="button"
                  onClick={() => setWealthRange(r.value)}
                  aria-label={r.full}
                  aria-pressed={wealthRange === r.value}
                  className={`px-md py-xs rounded-full font-mono-data text-mono-data uppercase tracking-widest transition-colors ${
                    wealthRange === r.value
                      ? 'bg-surface-container-high text-on-surface border border-border-subtle'
                      : 'text-text-muted border border-transparent hover:text-on-surface-variant'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="border-t border-border-subtle mt-sm pt-sm">
              <BudgetBar usage={budgetUsage} pace={budgetPace} onDefine={() => navigate('/presupuesto')} />
            </div>
          </BentoCell>
        </Stagger.Item>

        {/* 2 · Fila de apoyo bajo el hero: dos tarjetas simétricas (col-6 c/u en
            escritorio; apiladas en móvil) — En qué gasto · Recordatorios. El donut
            usa su layout horizontal (dona + leyenda al lado) para llenar el ancho. */}
        <Stagger.Item className="col-span-2 md:col-span-6">
          <BentoCell title={t('dashboard.whereSpend')} icon="donut_small" className="h-full">
            <CategoryDonut data={breakdown} />
          </BentoCell>
        </Stagger.Item>

        <Stagger.Item className="col-span-2 md:col-span-6">
          <BentoCell title={t('dashboard.monthReminder')} icon="radar" className="h-full">
            <SignalsRail signals={signals} onNavigate={navigate} />
          </BentoCell>
        </Stagger.Item>
      </Stagger>
    </div>
  );
}
