// «Simular cancelaciones»: lista de recurrentes activos con su equivalente mensual
// y un interruptor nativo (checkbox con role="switch" dentro de su <label>).
// Encendido = el recurrente sigue en la proyección; apagado = se simula cancelado.
// El estado se comunica también con texto («Incluido» / «Apagado en la simulación»)
// y con el efecto «+RD$X/mes». Solo presentación: no escribe en ningún store.
import SwitchControl from './SwitchControl';
import { useI18n } from '../../../contexts/I18nContext';
import { formatCurrencyWhole } from '../../../utils/formatters';

function SwitchRow({ item, off, onToggle, t }) {
  const amount = formatCurrencyWhole(item.monthly);
  return (
    <li>
      <label className="flex items-center gap-sm py-sm border-t border-border-subtle first:border-t-0 cursor-pointer">
        <SwitchControl checked={!off} onChange={() => onToggle(item.id)} />
        <span className="min-w-0 flex-1">
          <span className="block font-body-md text-body-md text-on-surface break-words">{item.name}</span>
          <span className="block font-mono-data text-mono-data text-text-muted">
            {t('projection.cancelPerMonth').replace('{amount}', amount)}
            {' · '}
            {off ? t('projection.cancelOff') : t('projection.cancelIncluded')}
          </span>
        </span>
        {off && (
          <span className={`shrink-0 font-headline-md text-[14px] tabular-nums ${item.isIncome ? 'text-accent-error' : 'text-tertiary'}`}>
            {(item.isIncome ? t('projection.cancelLoss') : t('projection.cancelGain')).replace('{amount}', amount)}
          </span>
        )}
      </label>
    </li>
  );
}

function Group({ title, items, excluded, onToggle, t }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="font-label-sm text-label-sm text-on-surface-variant mb-xs">{title}</h4>
      <ul>
        {items.map((it) => <SwitchRow key={it.id} item={it} off={excluded.has(it.id)} onToggle={onToggle} t={t} />)}
      </ul>
    </div>
  );
}

export default function CancellationPanel({ expenses, incomes, excludedIds, onToggle }) {
  const { t } = useI18n();
  const excluded = new Set(excludedIds);
  const sum = (items) => items.filter((i) => excluded.has(i.id)).reduce((s, i) => s + i.monthly, 0);
  // Efecto neto de lo apagado sobre el dinero real, por mes.
  const net = sum(expenses) - sum(incomes);
  const empty = expenses.length === 0 && incomes.length === 0;

  return (
    <div className="flex flex-col gap-sm">
      <h3 className="font-mono-data text-mono-data text-on-surface-variant uppercase">{t('projection.cancelTitle')}</h3>
      <p className="font-label-sm text-label-sm text-on-surface-variant">{t('projection.cancelHint')}</p>

      {empty ? (
        <p className="font-body-md text-body-md text-text-muted">{t('projection.cancelEmpty')}</p>
      ) : (
        <>
          <Group title={t('projection.cancelExpenses')} items={expenses} excluded={excluded} onToggle={onToggle} t={t} />
          <Group title={t('projection.cancelIncomes')} items={incomes} excluded={excluded} onToggle={onToggle} t={t} />
        </>
      )}

      <div aria-live="polite">
        {net !== 0 && (
          <p className="font-body-md text-body-md text-on-surface">
            {(net > 0 ? t('projection.cancelTotalGain') : t('projection.cancelTotalLoss'))
              .replace('{amount}', formatCurrencyWhole(Math.abs(net)))}
          </p>
        )}
      </div>
    </div>
  );
}
