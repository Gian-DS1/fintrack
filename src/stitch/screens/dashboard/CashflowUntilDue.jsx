// «¿Me alcanza hasta el pago?»: disclosure dentro de la celda «Dinero real» con
// los movimientos previstos del EFECTIVO hasta el pago de las tarjetas y el
// efectivo restante tras cada uno. Solo presentación: recibe el resultado de
// getCashflowUntilCardDue. Cerrado por defecto; botón con aria-expanded.
// El saldo negativo se comunica con icono + texto «Sin fondos», no solo con color.
import { useId, useState } from 'react';
import MS from '../../MS';
import { useI18n } from '../../../contexts/I18nContext';
import { formatCurrency, formatDate } from '../../../utils/formatters';

const fmt = (n) => formatCurrency(n);
const signed = (n) => (n > 0 ? `+${fmt(n)}` : fmt(n));

// Etiqueta visible de un movimiento: los pagos de tarjeta y préstamo llevan un
// prefijo; los recurrentes sin descripción caen en un rótulo genérico por tipo.
function eventLabel(e, t) {
  if (e.kind === 'card_payment') return t('dashboard.cashflowCardPayment').replace('{name}', e.label);
  if (e.kind === 'loan') return t('dashboard.cashflowLoanPayment').replace('{name}', e.label);
  if (e.label) return e.label;
  if (e.kind === 'income') return t('dashboard.cashflowIncome');
  if (e.kind === 'savings') return t('dashboard.cashflowSavings');
  return t('dashboard.cashflowExpense');
}

export default function CashflowUntilDue({ cashflow }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { horizonISO, startCash, events, endCash, firstShortfall, skippedDebts, paymentsBeyondHorizon } = cashflow;
  const hasCardPayment = events.some((e) => e.kind === 'card_payment');

  return (
    <div className="mt-md border-t border-border-subtle pt-sm">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-sm text-left font-mono-data text-mono-data text-primary hover:underline focus-visible:underline outline-none"
      >
        <span className="min-w-0 break-words">{t('dashboard.cashflowToggle').replace('{date}', formatDate(horizonISO))}</span>
        <MS name="expand_more" className={`!text-[18px] shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div id={panelId} className="mt-sm flex flex-col gap-sm">
          <p className="flex flex-wrap justify-between gap-x-sm font-label-sm text-label-sm text-on-surface-variant">
            <span>{t('dashboard.cashflowStart')}</span>
            <span className="tabular-nums text-on-surface">{fmt(startCash)}</span>
          </p>

          {events.length === 0 ? (
            <p className="font-body-md text-body-md text-text-muted">{t('dashboard.cashflowEmpty')}</p>
          ) : (
            <ul className="flex flex-col">
              {events.map((e, i) => {
                const noFunds = e.balanceAfter < 0;
                return (
                  <li key={`${e.dateISO}-${e.kind}-${e.sourceId}-${i}`} className="py-sm border-t border-border-subtle first:border-t-0">
                    <div className="flex items-start justify-between gap-sm">
                      <div className="min-w-0">
                        <p className="font-body-md text-body-md text-on-surface break-words">
                          {eventLabel(e, t)}
                          {e.overdue && <span className="text-accent-warning"> · {t('dashboard.cashflowOverdue')}</span>}
                        </p>
                        <p className="font-mono-data text-mono-data text-text-muted">{formatDate(e.dateISO)}</p>
                      </div>
                      <span className="shrink-0 font-body-md text-body-md tabular-nums text-on-surface">{signed(e.amount)}</span>
                    </div>
                    <p className={`mt-xs flex flex-wrap items-center gap-x-xs font-label-sm text-label-sm tabular-nums ${noFunds ? 'text-accent-error' : 'text-on-surface-variant'}`}>
                      {noFunds && <MS name="warning" fill className="!text-[14px] shrink-0" />}
                      {noFunds && <span className="font-medium">{t('dashboard.cashflowNoFunds')} ·</span>}
                      <span>{t('dashboard.cashflowLeft')} {fmt(e.balanceAfter)}</span>
                    </p>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="flex flex-wrap justify-between gap-x-sm border-t border-border-subtle pt-sm font-label-sm text-label-sm text-on-surface-variant">
            <span>{t('dashboard.cashflowEnd')}</span>
            <span className={`tabular-nums ${endCash < 0 ? 'text-accent-error' : 'text-on-surface'}`}>{fmt(endCash)}</span>
          </p>

          {firstShortfall ? (
            <p className="flex items-start gap-xs font-body-md text-body-md text-accent-error">
              <MS name="warning" fill className="!text-[16px] shrink-0 mt-[2px]" />
              <span>
                {t('dashboard.cashflowShortfall')
                  .replace('{date}', formatDate(firstShortfall.dateISO))
                  .replace('{amount}', fmt(firstShortfall.shortfall))
                  .replace('{card}', firstShortfall.label)}
              </span>
            </p>
          ) : hasCardPayment && paymentsBeyondHorizon === 0 && (
            <p className="font-body-md text-body-md text-on-surface">{t('dashboard.cashflowEnough')}</p>
          )}

          {paymentsBeyondHorizon > 0 && (
            <p className="font-label-sm text-label-sm text-text-muted">
              {t('dashboard.cashflowBeyondHorizon').replace('{n}', paymentsBeyondHorizon)}
            </p>
          )}

          {skippedDebts.length > 0 && (
            <p className="font-label-sm text-label-sm text-text-muted">
              {t('dashboard.cashflowSkippedDebts').replace('{n}', skippedDebts.length)}
            </p>
          )}
          <p className="font-label-sm text-label-sm text-text-muted">{t('dashboard.cashflowScheduledOnly')}</p>
        </div>
      )}
    </div>
  );
}
