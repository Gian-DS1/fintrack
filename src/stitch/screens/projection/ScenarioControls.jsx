// Selector de escenario (pills con aria-pressed, como el rango del Resumen), el
// recorte de «Con recortes» y las categorías esenciales de «Solo lo esencial».
// Solo presentación: el estado vive en useSimulation y se guarda en el dispositivo.
import MS from '../../MS';
import Emoji from '../../Emoji';
import { useI18n } from '../../../contexts/I18nContext';
import { MIN_CUT_PCT, MAX_CUT_PCT } from './simulationStorage';

const SCENARIOS = [
  { value: 'current', labelKey: 'projection.scenarioCurrent' },
  { value: 'essential', labelKey: 'projection.scenarioEssential' },
  { value: 'cuts', labelKey: 'projection.scenarioCuts' },
];

export default function ScenarioControls({ simulation, onChange, categories }) {
  const { t } = useI18n();
  const { scenario, cutPct, essentialCategoryIds } = simulation;
  const pct = Math.round(cutPct * 100);

  const toggleCategory = (id, checked) => onChange({
    essentialCategoryIds: checked
      ? [...essentialCategoryIds, id]
      : essentialCategoryIds.filter((x) => x !== id),
  });

  return (
    <div className="flex flex-col gap-sm">
      <div role="group" aria-label={t('projection.scenarioLabel')} className="flex flex-wrap gap-xs">
        {SCENARIOS.map((s) => (
          <button
            key={s.value}
            type="button"
            aria-pressed={scenario === s.value}
            onClick={() => onChange({ scenario: s.value })}
            className={`px-md py-xs rounded-full font-mono-data text-mono-data uppercase tracking-widest transition-colors ${
              scenario === s.value
                ? 'bg-surface-container-high text-on-surface border border-border-subtle'
                : 'text-text-muted border border-transparent hover:text-on-surface-variant'
            }`}
          >
            {t(s.labelKey)}
          </button>
        ))}
      </div>

      {scenario === 'cuts' && (
        <label className="flex flex-col gap-xs max-w-[24rem]">
          <span className="font-mono-data text-mono-data text-text-muted uppercase">
            {t('projection.cutLabel')} · <span className="text-primary">{t('projection.cutValue').replace('{pct}', pct)}</span>
          </span>
          <input
            type="range"
            min={MIN_CUT_PCT * 100}
            max={MAX_CUT_PCT * 100}
            step={5}
            value={pct}
            onChange={(e) => onChange({ cutPct: Number(e.target.value) / 100 })}
            aria-valuetext={t('projection.cutValue').replace('{pct}', pct)}
            className="accent-primary w-full"
          />
        </label>
      )}

      {scenario === 'essential' && (
        <fieldset className="flex flex-col gap-xs min-w-0">
          <legend className="font-mono-data text-mono-data text-text-muted uppercase mb-xs">{t('projection.essentialTitle')}</legend>
          <p className="font-label-sm text-label-sm text-on-surface-variant">{t('projection.essentialHint')}</p>
          {categories.length === 0 ? (
            <p className="font-body-md text-body-md text-text-muted">{t('projection.essentialNoCategories')}</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-md gap-y-xs">
              {categories.map((c) => (
                <li key={c.id}>
                  <label className="flex items-center gap-sm py-xs cursor-pointer min-w-0">
                    <input
                      type="checkbox"
                      className="stitch-check"
                      checked={essentialCategoryIds.includes(c.id)}
                      onChange={(e) => toggleCategory(c.id, e.target.checked)}
                    />
                    {c.icon && <span aria-hidden="true" className="shrink-0 flex items-center"><Emoji e={c.icon} size={16} /></span>}
                    <span className="font-body-md text-body-md text-on-surface break-words min-w-0">{c.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {essentialCategoryIds.length === 0 && categories.length > 0 && (
            <p className="flex items-start gap-xs font-body-md text-body-md text-on-surface">
              <MS name="info" className="!text-[16px] shrink-0 mt-[2px] text-primary" />
              <span>{t('projection.essentialEmpty')}</span>
            </p>
          )}
        </fieldset>
      )}
    </div>
  );
}
