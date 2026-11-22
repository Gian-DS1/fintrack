// Celda «Dinero real» del Resumen: efectivo − saldo pendiente de todas las
// tarjetas, siempre con la fecha de hoy. Solo presentación: recibe el resultado
// de getRealMoney, el ahorro total y la lista de movimientos previstos
// (getCashflowUntilCardDue); no calcula ni lee stores.
// El estado crítico (dinero real < 0) se comunica con icono + texto, no solo con
// color, y sin aria-live: el valor no cambia en vivo.
import { Link } from 'react-router-dom';
import MS from '../../MS';
import CountUp from '../../CountUp';
import { InfoTip } from '../../InfoTip';
import { useI18n } from '../../../contexts/I18nContext';
import { formatCurrency } from '../../../utils/formatters';
import { BentoCell } from './dashboardUi';
import CashflowUntilDue from './CashflowUntilDue';
import { canAffordPayment } from './selectors';

const fmt = (n) => formatCurrency(n);
const CARDS_PATH = '/mis-finanzas?tab=cards';
const PROJECTION_PATH = '/proyeccion';

// Ajustes, directo al campo del efectivo inicial (StitchSettings lo enfoca con el ancla).
const SETTINGS_PATH = '/ajustes#efectivo-inicial';

export default function RealMoneyCard({ data, totalSavings, cashflow, legacyPaidCycles = false, onDismissLegacy }) {
  const { t } = useI18n();
  const { cash, cardsOwed, realMoney, isCritical, shortfall, cards, cardsWithoutCycle } = data;
  const hasCards = cards.length > 0;
  const savingsCover = canAffordPayment(cash, totalSavings, cardsOwed);

  return (
    <BentoCell className="h-full">
      <div className="flex items-center gap-xs border-b border-border-subtle pb-sm mb-sm">
        <MS name="account_balance_wallet" className="!text-[14px] text-text-muted shrink-0" />
        <span className="font-mono-data text-mono-data text-on-surface-variant uppercase">{t('dashboard.realMoney')}</span>
        <InfoTip text={t('dashboard.realMoneyInfo')} />
      </div>

      {/* clamp: misma escala que "Mis finanzas"; en 375 px un monto largo no se corta. */}
      <div className={`flex items-center gap-sm font-hero-headline text-[clamp(26px,8vw,40px)] sm:text-[48px] tracking-tighter leading-none tabular-nums ${isCritical ? 'text-accent-error' : 'text-on-surface'}`}>
        {isCritical && <MS name="warning" fill className="!text-[length:inherit] shrink-0" />}
        <CountUp value={realMoney} format={fmt} />
      </div>

      <div className="flex flex-wrap gap-x-xl gap-y-sm mt-md">
        <div className="flex flex-col">
          <span className="font-mono-data text-mono-data text-text-muted uppercase">{t('dashboard.cash')}</span>
          <span className="font-headline-md text-[18px] tracking-tight tabular-nums text-on-surface">{fmt(cash)}</span>
        </div>
        {hasCards && (
          <div className="flex flex-col">
            <span className="font-mono-data text-mono-data text-text-muted uppercase">{t('dashboard.cardBalance')}</span>
            <span className="font-headline-md text-[18px] tracking-tight tabular-nums text-on-surface">{fmt(-cardsOwed)}</span>
          </div>
        )}
      </div>

      {isCritical && (
        <div className="mt-md flex flex-col gap-xs">
          <p className="font-body-md text-body-md text-on-surface">
            {t('dashboard.realMoneyCritical').replace('{amount}', fmt(shortfall))}
          </p>
          <p className="font-label-sm text-label-sm text-on-surface-variant">
            {savingsCover ? t('dashboard.realMoneySavingsCover') : t('dashboard.realMoneySavingsShort')}
          </p>
        </div>
      )}

      {cardsWithoutCycle > 0 && (
        <p className="mt-sm font-label-sm text-label-sm text-text-muted">
          {t('dashboard.cardsWithoutCycle').replace('{n}', cardsWithoutCycle)}
        </p>
      )}

      {legacyPaidCycles && (
        <div className="mt-sm flex flex-col gap-xs">
          <p className="font-label-sm text-label-sm text-text-muted">{t('dashboard.legacyPaidCycles')}</p>
          <div className="flex flex-wrap gap-x-lg gap-y-xs">
            <Link to={SETTINGS_PATH} className="font-mono-data text-mono-data text-primary hover:underline">
              {t('dashboard.legacyPaidCyclesLink')}
            </Link>
            <button type="button" onClick={onDismissLegacy} className="font-mono-data text-mono-data text-primary hover:underline">
              {t('dashboard.legacyPaidCyclesDismiss')}
            </button>
          </div>
        </div>
      )}

      <div className="mt-sm flex flex-wrap gap-x-lg gap-y-xs">
        {(isCritical || cardsWithoutCycle > 0) && (
          <Link to={CARDS_PATH} className="font-mono-data text-mono-data text-primary hover:underline">
            {t('dashboard.seeCards')}
          </Link>
        )}
        <Link to={PROJECTION_PATH} className="inline-flex items-center gap-[3px] font-mono-data text-mono-data text-primary hover:underline">
          {t('dashboard.seeProjection')}
          <MS name="arrow_forward" className="!text-[14px]" />
        </Link>
      </div>

      <CashflowUntilDue cashflow={cashflow} />
    </BentoCell>
  );
}
