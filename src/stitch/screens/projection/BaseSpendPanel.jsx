// «Gasto variable base»: muestra el promedio y los meses usados, deja corregirlo a
// mano y restablecerlo. Solo presentación; el valor manual se guarda en el
// dispositivo (useSimulation). El campo conserva su texto mientras se escribe
// (un «5.» no debe perder el punto), por eso lleva su propio borrador.
import { useId, useState } from 'react';
import StitchCurrencyInput from '../../StitchCurrencyInput';
import { inputCls } from '../../formUi';
import { useI18n } from '../../../contexts/I18nContext';
import { formatCurrencyWhole } from '../../../utils/formatters';

const toRaw = (override) => (override == null ? '' : String(override));

export default function BaseSpendPanel({ base, override, scenario, onChange }) {
  const { t } = useI18n();
  const inputId = useId();
  const [draft, setDraft] = useState(() => toRaw(override));
  const hasAverage = base.variableMonthsUsed > 0;

  const handleChange = (raw) => {
    setDraft(raw);
    const value = raw === '' ? null : Number(raw);
    onChange(Number.isFinite(value) ? value : null);
  };
  const handleReset = () => {
    setDraft('');
    onChange(null);
  };

  return (
    <div className="flex flex-col gap-sm">
      <h3 className="font-mono-data text-mono-data text-on-surface-variant uppercase">{t('projection.baseTitle')}</h3>

      <p className="font-body-md text-body-md text-on-surface">
        {hasAverage
          ? (base.variableMonthsUsed === 1 ? t('projection.averageOne') : t('projection.averageMany').replace('{n}', base.variableMonthsUsed))
              .replace('{amount}', formatCurrencyWhole(base.average))
          : t('projection.noHistory')}
      </p>
      {hasAverage && base.variableScheduled > 0 && (
        <p className="font-label-sm text-label-sm text-on-surface-variant">
          {t('projection.baseScheduled')
            .replace('{scheduled}', formatCurrencyWhole(base.variableScheduled))
            .replace('{amount}', formatCurrencyWhole(base.variableUnscheduled))}
        </p>
      )}

      <div className="flex flex-col gap-xs max-w-[20rem]">
        <label htmlFor={inputId} className="font-mono-data text-mono-data text-text-muted uppercase">
          {t('projection.baseInputLabel')}
        </label>
        <div className="flex items-stretch gap-sm">
          <StitchCurrencyInput
            id={inputId}
            value={draft}
            onChange={handleChange}
            placeholder={hasAverage ? String(Math.round(base.variableUnscheduled)) : '0'}
            className={`${inputCls} min-w-0`}
          />
          {override != null && (
            <button
              type="button"
              onClick={handleReset}
              className="shrink-0 px-md py-sm border border-border-subtle text-on-surface-variant font-label-sm text-label-sm rounded hover:bg-surface-container-high"
            >
              {t('projection.baseReset')}
            </button>
          )}
        </div>
      </div>

      {override != null && <p className="font-label-sm text-label-sm text-on-surface-variant">{t('projection.baseManualInUse')}</p>}
      {scenario === 'essential' && <p className="font-label-sm text-label-sm text-text-muted">{t('projection.baseIgnoredEssential')}</p>}
    </div>
  );
}
