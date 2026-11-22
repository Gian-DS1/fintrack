// Alternativa en tabla del gráfico de proyección: mismos datos, legibles con un
// lector de pantalla. Disclosure cerrado por defecto (button + aria-expanded).
// El dinero real negativo lleva icono + texto «Negativo», no solo color.
import { useId, useState } from 'react';
import MS from '../../MS';
import { useI18n } from '../../../contexts/I18nContext';
import { formatCurrencyWhole } from '../../../utils/formatters';
import { monthName } from '../../../i18n/runtime';

const fmt = (n) => formatCurrencyWhole(n);

function RealMoneyCell({ value }) {
  const { t } = useI18n();
  const negative = value < 0;
  return (
    <span className={`inline-flex flex-wrap items-center justify-end gap-x-xs ${negative ? 'text-accent-error' : 'text-on-surface'}`}>
      {negative && <MS name="warning" fill className="!text-[14px] shrink-0" />}
      {negative && <span className="font-medium">{t('projection.negative')} ·</span>}
      <span>{fmt(value)}</span>
    </span>
  );
}

export default function ProjectionTable({ start, points }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="mt-sm border-t border-border-subtle pt-sm">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-sm text-left font-mono-data text-mono-data text-primary hover:underline focus-visible:underline outline-none"
      >
        <span>{t('projection.tableToggle')}</span>
        <MS name="expand_more" className={`!text-[18px] shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div id={panelId} className="mt-sm overflow-x-auto">
          <table className="w-full text-left border-collapse font-body-md text-body-md tabular-nums">
            <caption className="sr-only">{t('projection.tableCaption')}</caption>
            <thead>
              <tr className="border-b border-border-subtle font-mono-data text-mono-data text-text-muted uppercase">
                <th scope="col" className="py-xs pr-sm font-normal">{t('projection.tableMonth')}</th>
                <th scope="col" className="py-xs px-sm font-normal text-right">{t('projection.tableIncome')}</th>
                <th scope="col" className="py-xs px-sm font-normal text-right">{t('projection.tableOutflow')}</th>
                <th scope="col" className="py-xs pl-sm font-normal text-right">{t('projection.tableRealMoney')}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border-subtle">
                <th scope="row" className="py-xs pr-sm font-normal text-on-surface">{t('projection.today')}</th>
                <td className="py-xs px-sm text-right text-text-muted">—</td>
                <td className="py-xs px-sm text-right text-text-muted">—</td>
                <td className="py-xs pl-sm text-right"><RealMoneyCell value={start} /></td>
              </tr>
              {points.map((p) => (
                <tr key={p.key} className="border-b border-border-subtle last:border-b-0">
                  <th scope="row" className="py-xs pr-sm font-normal text-on-surface whitespace-nowrap">{monthName(p.m)} {p.y}</th>
                  <td className="py-xs px-sm text-right text-on-surface-variant">{fmt(p.income)}</td>
                  <td className="py-xs px-sm text-right text-on-surface-variant">
                    {fmt(p.recurringOut + p.loanOut + p.variableOut + p.fixedOut)}
                  </td>
                  <td className="py-xs pl-sm text-right"><RealMoneyCell value={p.realMoney} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
