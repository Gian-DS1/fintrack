// Tarjeta de deuda individual: estrategia avalancha (PAGAR 1RO), saldo, % pagado,
// interés, cuota, próximo pago, proyección de liquidación (payoff) y acciones.
import { useMemo } from 'react';
import MS from '../../MS';
import { Stagger } from '../../StitchMotion';
import { formatCurrency, formatDate, toISODate } from '../../../utils/formatters';
import { getNextLoanDueDate } from '../../../utils/loanReminders';
import { useI18n } from '../../../contexts/I18nContext';
import { getPayoff } from './payoff';

const fmt = (n) => formatCurrency(n);

export default function DebtItem({ debt, index, onPay, onHistory, onEdit, onDelete, payments = [] }) {
  const { t } = useI18n();
  const high = Number(debt.interestRate) >= 8;
  const paidPct = Number(debt.originalAmount) > 0
    ? (1 - Number(debt.currentBalance) / Number(debt.originalAmount)) * 100
    : 0;
  const payoff = useMemo(() => getPayoff(debt), [debt]);
  // Próxima fecha de pago pendiente: si la cuota de este ciclo ya fue pagada,
  // avanza al mes siguiente sin requerir reescribir la base de datos.
  const nextDueISO = debt.due_date ? getNextLoanDueDate(debt, payments) : null;

  return (
    <Stagger.Item className={`bg-surface-card border rounded-lg p-md inner-glow flex flex-col gap-md ${high ? 'border-accent-warning/30' : 'border-border-subtle'}`}>
      <div className="flex justify-between items-center gap-sm">
        <span className="font-label-sm text-label-sm uppercase text-on-surface flex items-center gap-xs min-w-0">
          {index === 0 && <span className="font-mono-data text-[8px] text-accent-error border border-accent-error/40 rounded px-1 shrink-0">{t('screens.debts.payFirst')}</span>}
          <span className="break-words min-w-0">{debt.creditorName}</span>
        </span>
        <span className={`font-mono-data text-mono-data shrink-0 ${high ? 'text-accent-warning' : 'text-text-muted'}`}>{Number(debt.interestRate).toFixed(1)}% TNA</span>
      </div>

      <div className={`font-headline-md text-headline-md ${high ? 'text-accent-warning' : 'text-on-surface'}`}>{fmt(debt.currentBalance)}</div>

      <div className="w-full bg-surface-container-highest h-1 rounded-full overflow-hidden">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, paidPct))}%` }} />
      </div>
      <div className="flex justify-between font-mono-data text-mono-data text-text-muted">
        <span>{t('screens.debts.paid')} {paidPct.toFixed(0)}%</span>
        <span>{t('screens.debts.quota')} {fmt(debt.monthlyPayment)}</span>
      </div>

      {nextDueISO && (
        <div className="flex justify-between items-center font-mono-data text-mono-data text-text-muted">
          <span className="flex items-center gap-xs"><MS name="event_upcoming" className="!text-[13px] text-tertiary" /> {t('screens.debts.nextPayment')}</span>
          <span className="text-on-surface-variant tabular-nums">{formatDate(nextDueISO)}</span>
        </div>
      )}

      {/* Proyección de liquidación */}
      {payoff.coversInterest ? (
        <div className="flex flex-wrap items-center justify-between gap-xs bg-surface-container-lowest border border-border-subtle rounded px-sm py-xs inner-glow">
          <span className="font-mono-data text-mono-data text-text-muted flex items-center gap-xs">
            <MS name="event_available" className="!text-[13px] text-tertiary" /> {t('screens.debts.freeIn')} {payoff.months} {payoff.months === 1 ? t('screens.vaults.month') : t('dashboard.months')}
          </span>
          <span className="font-mono-data text-mono-data text-text-muted">{formatDate(toISODate(payoff.payoffDate))}</span>
          <span className="font-mono-data text-mono-data text-text-muted w-full">{t('screens.debts.totalInterests')} {fmt(payoff.totalInterest)}</span>
        </div>
      ) : (
        <div className="flex items-center gap-xs bg-accent-warning/10 border border-accent-warning/30 rounded px-sm py-xs">
          <MS name="warning" className="!text-[13px] text-accent-warning" />
          <span className="font-mono-data text-mono-data text-accent-warning normal-case tracking-normal">{t('screens.debts.paymentNotCovering')}</span>
        </div>
      )}

      <div className="flex gap-sm mt-xs">
        <button onClick={() => onPay(debt)} className="flex-1 border border-border-subtle text-primary font-mono-data text-mono-data uppercase py-xs rounded hover:bg-primary/10 transition-colors">{t('screens.debts.payQuota')}</button>
        <button onClick={() => onHistory(debt)} className="px-sm border border-border-subtle text-text-muted rounded hover:text-on-surface" aria-label={t('common.history')}><MS name="history" className="!text-[14px]" /></button>
        <button onClick={() => onEdit(debt)} className="px-sm border border-border-subtle text-text-muted rounded hover:text-on-surface" aria-label={t('common.edit')}><MS name="edit" className="!text-[14px]" /></button>
        <button onClick={() => onDelete(debt)} className="px-sm border border-border-subtle text-text-muted rounded hover:text-accent-error" aria-label={t('common.delete')}><MS name="delete" className="!text-[14px]" /></button>
      </div>
    </Stagger.Item>
  );
}
