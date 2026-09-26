// Calendario — centro de planificación: movimientos pasados + vencimientos
// futuros + próximos pagos. Lógica pura en calendar/selectors.js. Solo lectura.
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import MS from '../MS';
import { Stagger } from '../StitchMotion';
import StitchSelect from '../StitchSelect';
import CountUp from '../CountUp';
import useTransactionStore from '../../stores/useTransactionStore';
import useCategoryStore from '../../stores/useCategoryStore';
import useDebtStore from '../../stores/useDebtStore';
import useCreditCardStore from '../../stores/useCreditCardStore';
import useSavingsStore from '../../stores/useSavingsStore';
import useRecurringStore from '../../stores/useRecurringStore';
import { formatCurrency } from '../../utils/formatters';
import { monthName, dayShort } from '../../i18n/runtime';
import { useI18n } from '../../contexts/I18nContext';
import { getDayMovements, getDueEvents, getMonthSummary, getUpcoming } from './calendar/selectors';
import DayCell from './calendar/DayCell';
import DayDetail from './calendar/DayDetail';
import UpcomingRail from './calendar/UpcomingRail';
import { CHART } from '../chartTokens';

const fmt = (n) => formatCurrency(n);

export default function StitchCalendar() {
  const { t, language } = useI18n();
  const navigate = useNavigate();

  const LEGEND = [
    { c: CHART.error, l: t('debts.debt') }, { c: CHART.warning, l: t('creditCards.card') },
    { c: CHART.tertiary, l: t('savings.goal') }, { c: CHART.secondary, l: t('screens.calendar.recurring') },
  ];
  const transactions = useTransactionStore((s) => s.transactions);
  const categories = useCategoryStore((s) => s.categories);
  const debts = useDebtStore((s) => s.debts);
  const debtPayments = useDebtStore((s) => s.payments);
  const cards = useCreditCardStore((s) => s.cards);
  const goals = useSavingsStore((s) => s.goals);
  const recurring = useRecurringStore((s) => s.recurring);

  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState(null);

  const navMonth = (dir) => {
    let mm = month + dir, yy = year;
    if (mm < 0) { mm = 11; yy--; } else if (mm > 11) { mm = 0; yy++; }
    setMonth(mm); setYear(yy); setSelected(null);
  };

  const movements = useMemo(() => getDayMovements(transactions, year, month), [transactions, year, month]);
  const dueEvents = useMemo(() => getDueEvents({ debts, cards, goals, recurring, debtPayments }, year, month, now, transactions), [debts, debtPayments, cards, goals, recurring, year, month, now, transactions]);
  const summary = useMemo(() => getMonthSummary(transactions, year, month), [transactions, year, month]);
  const upcoming = useMemo(() => getUpcoming({ debts, cards, goals, recurring, debtPayments }, now, transactions, 30), [debts, debtPayments, cards, goals, recurring, now, transactions]);

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const todayDay = now.getDate();
  const selectedISO = selected ? `${year}-${String(month + 1).padStart(2, '0')}-${String(selected).padStart(2, '0')}` : null;

  const monthOptions = useMemo(
    () => Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: monthName(i) })),
    // `language` es dependencia real: monthName() lee el idioma del runtime, fuera de React.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language],
  );
  const yearOptions = [];
  for (let yy = now.getFullYear() + 1; yy >= now.getFullYear() - 5; yy--) yearOptions.push({ value: String(yy), label: String(yy) });

  return (
    <div className="p-md sm:p-margin-safe max-w-[1728px] mx-auto w-full lg:h-[calc(100dvh-4rem)] flex flex-col overflow-hidden">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-md mb-md shrink-0">
        <div>
          <div className="flex items-center gap-sm mb-xs">
            <span className="w-2 h-2 rounded-full bg-secondary live-dot" />
            <span className="font-mono-data text-mono-data text-secondary uppercase tracking-wider">{t('screens.calendar.monthlyView')}</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface">{monthName(month)} {year}</h1>
        </div>
        <div className="flex items-center gap-sm self-start">
          <div className="w-[140px]"><StitchSelect value={String(month)} onChange={(v) => { setMonth(Number(v)); setSelected(null); }} options={monthOptions} compact /></div>
          <div className="w-[100px]"><StitchSelect value={String(year)} onChange={(v) => { setYear(Number(v)); setSelected(null); }} options={yearOptions} compact /></div>
          <button onClick={() => navMonth(-1)} className="w-9 h-9 flex items-center justify-center rounded border border-border-subtle text-on-surface-variant hover:bg-surface-container-high hover:text-primary transition-colors inner-glow"><MS name="chevron_left" className="text-[18px]" /></button>
          <button onClick={() => navMonth(1)} className="w-9 h-9 flex items-center justify-center rounded border border-border-subtle text-on-surface-variant hover:bg-surface-container-high hover:text-primary transition-colors inner-glow"><MS name="chevron_right" className="text-[18px]" /></button>
        </div>
      </div>

      <Stagger className="flex flex-col gap-md flex-1 min-h-0">
        {/* Resumen del mes. En móvil una sola tarjeta con 3 filas (rótulo a la
            izquierda, monto a la derecha): un monto grande cabe a todo el ancho
            y no se gastan ~3 pantallas de scroll en tres tarjetas apiladas. En
            sm+ vuelven a ser 3 tarjetas lado a lado. */}
        <Stagger.Item className="shrink-0 max-sm:bg-surface-panel max-sm:border max-sm:border-border-subtle max-sm:rounded-lg max-sm:inner-glow max-sm:divide-y max-sm:divide-border-subtle sm:grid sm:grid-cols-3 sm:gap-md">
          {[
            { label: t('common.income'), cls: 'text-tertiary', value: summary.income, format: (n) => `+${fmt(n)}` },
            { label: t('common.expenses'), cls: 'text-accent-error', value: summary.expense, format: (n) => `−${fmt(n)}` },
            { label: t('common.balance'), cls: summary.balance >= 0 ? 'text-on-surface' : 'text-accent-error', value: summary.balance, format: (n) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))}` },
          ].map((s) => (
            <div key={s.label} className="flex max-sm:items-baseline max-sm:justify-between max-sm:gap-sm max-sm:px-md max-sm:py-sm sm:flex-col sm:gap-xs sm:bg-surface-panel sm:border sm:border-border-subtle sm:rounded-lg sm:inner-glow sm:p-md">
              <span className="font-mono-data text-mono-data text-text-muted uppercase">{s.label}</span>
              <span className={`font-headline-md text-[16px] sm:text-[20px] tracking-tight tabular-nums whitespace-nowrap ${s.cls}`}>
                <CountUp value={s.value} format={s.format} />
              </span>
            </div>
          ))}
        </Stagger.Item>

        {/* Grid + detalle */}
        <Stagger.Item data-tour="calendar-grid" className="grid grid-cols-1 lg:grid-cols-3 gap-gutter flex-1 min-h-0">
          <div className="lg:col-span-2 bg-surface-panel border border-border-subtle rounded-lg inner-glow p-md overflow-y-auto stitch-scroll">
            <div className="grid grid-cols-7 gap-px mb-sm">
              {Array.from({ length: 7 }, (_, i) => dayShort(i)).map((d) => <div key={d} className="font-mono-data text-mono-data text-text-muted uppercase text-center py-sm">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-px">
              {cells.map((d, i) => d === null
                ? <div key={i} className="h-[clamp(48px,9vh,72px)]" />
                : <DayCell key={i} day={d} movement={movements[d]} dues={dueEvents[d]} isToday={isCurrentMonth && d === todayDay} isSelected={selected === d} onClick={(day) => setSelected(selected === day ? null : day)} />)}
            </div>
            {/* Leyenda */}
            <div className="flex flex-wrap gap-md mt-md pt-sm border-t border-border-subtle">
              {LEGEND.map((x) => (
                <span key={x.l} className="flex items-center gap-xs font-mono-data text-mono-data text-text-muted">
                  <span className="w-2 h-2 rounded-full" style={{ background: x.c }} /> {x.l}
                </span>
              ))}
            </div>
          </div>

          {/* Columna derecha: detalle del día (arriba) + próximos vencimientos (abajo).
              Scroll interno propio si el contenido excede, para no scrollear la página. */}
          <div className="flex flex-col gap-gutter overflow-y-auto stitch-scroll min-h-0">
            <DayDetail iso={selectedISO} movement={selected ? movements[selected] : null} dues={selected ? dueEvents[selected] : null} categories={categories} />
            <UpcomingRail items={upcoming} onNavigate={navigate} />
          </div>
        </Stagger.Item>
      </Stagger>
    </div>
  );
}
