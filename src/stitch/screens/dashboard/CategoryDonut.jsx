// Donut de gastos del mes por categoría (top 5 + Otros). La dona ancla el
// "parte del todo" (total al centro); la comparación fina vive en la leyenda:
// cada fila es una mini barra horizontal (longitudes comparables a simple
// vista) con el emoji de la categoría. Hover/click/focus sincronizados entre
// leyenda y dona: el segmento activo crece y proyecta una sombra de su color.
import { useState } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Sector } from 'recharts';
import { formatCurrency } from '../../../utils/formatters';
import { useI18n } from '../../../contexts/I18nContext';
import { EmptyCell } from './dashboardUi';
import Emoji from '../../Emoji';

const fmt = (n) => formatCurrency(n);
const pct0 = (n) => `${Math.round(Number(n) || 0)}%`;

// Tamaño del monto del centro según su longitud: el agujero de la dona es un
// espacio fijo, así que un monto largo (RD$ 1,472,025.00) baja de cuerpo para
// caber COMPLETO en una línea, en vez de truncarse o abreviarse.
const centerSizeFor = (text, compact) => {
  if (text.length > 14) return 'text-[11px]';
  if (text.length > 11) return 'text-[13px]';
  return compact ? 'text-[16px]' : 'text-[15px]';
};

// Forma activa: el sector crece hacia afuera + sombra (drop-shadow) de su color.
function ActiveSector(props) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  return (
    <g style={{ filter: `drop-shadow(0 0 6px ${fill}aa)` }}>
      <Sector
        cx={cx} cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 6}
        startAngle={startAngle} endAngle={endAngle}
        fill={fill}
        cornerRadius={3}
      />
    </g>
  );
}

export default function CategoryDonut({ data, compact = false }) {
  const { t } = useI18n();
  const [active, setActive] = useState(-1);
  if (!data || data.length === 0) return <EmptyCell icon="donut_small" message={t('screens.charts.noExpensesThisMonth')} />;

  const total = data.reduce((s, d) => s + d.value, 0);
  const withPct = data.map((d) => ({ ...d, pct: total > 0 ? (d.value / total) * 100 : 0 }));
  const activeName = active >= 0 ? withPct[active]?.name : null;
  // Las barras de la leyenda escalan contra la categoría mayor (no contra el
  // total): la más grande llena el riel y el resto se compara contra ella.
  const maxValue = Math.max(...withPct.map((d) => d.value));

  return (
    // Normal: fila con wrap — la dona y la leyenda van lado a lado SOLO si la
    // leyenda conserva ≥300px (los montos completos no caben en menos); si no,
    // la leyenda baja a su propia línea a todo el ancho. Se adapta al ancho real
    // de la tarjeta sin breakpoints ni desbordes.
    <div className={`flex-grow flex min-h-[200px] ${compact ? 'flex-col gap-lg justify-center' : 'flex-row flex-wrap gap-x-xl gap-y-lg items-center min-h-[240px]'}`}>
      {/* Dona: en compact arriba (más grande, centrada); en normal al lado de la leyenda. */}
      <div className={`relative shrink-0 mx-auto ${compact ? 'w-full max-w-[260px] h-[240px] sm:h-[260px]' : 'w-[280px] max-w-full h-[240px]'}`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={withPct}
              dataKey="value"
              nameKey="name"
              innerRadius="58%"
              outerRadius="86%"
              paddingAngle={2}
              stroke="none"
              activeIndex={active >= 0 ? active : undefined}
              activeShape={ActiveSector}
              onMouseEnter={(_, i) => setActive(i)}
              onMouseLeave={() => setActive(-1)}
              onClick={(_, i) => setActive((prev) => (prev === i ? -1 : i))}
              isAnimationActive={false}
            >
              {withPct.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.color}
                  opacity={active === -1 || active === i ? 1 : 0.35}
                  style={{ transition: 'opacity 150ms ease-out' }}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {/* El bloque se limita al diámetro del agujero (innerRadius 58%). El
              nombre envuelve en varias líneas y el monto baja de cuerpo según
              su longitud: TODO se muestra completo, nada se trunca ni abrevia. */}
          <div className="flex flex-col items-center text-center leading-tight max-w-[62%]">
            <span className="font-mono-data text-[9px] text-text-muted uppercase break-words max-w-full w-full">{activeName || 'Total'}</span>
            <span className={`font-headline-md text-on-surface tracking-tight tabular-nums whitespace-nowrap ${centerSizeFor(fmt(active >= 0 ? withPct[active].value : total), compact)}`}>
              {fmt(active >= 0 ? withPct[active].value : total)}
            </span>
            {active >= 0 && <span className="font-mono-data text-[10px] text-text-muted tabular-nums">{`${withPct[active].pct.toFixed(1)}%`}</span>}
          </div>
        </div>
      </div>

      {/* Leyenda-barra: emoji + nombre + riel proporcional + monto + %. Hover,
          click (touch) y focus (teclado) sincronizados con la dona. */}
      <div className={`flex flex-col ${compact ? 'gap-sm w-full' : 'gap-xs flex-grow basis-[300px] min-w-0 max-w-[640px]'}`}>
        {withPct.map((d, i) => (
          <button
            type="button"
            key={i}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(-1)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(-1)}
            onClick={() => setActive((prev) => (prev === i ? -1 : i))}
            aria-pressed={active === i}
            className={`flex flex-col gap-xs font-mono-data text-mono-data rounded px-sm py-xs transition-colors text-left ${active === i ? 'bg-surface-container-high' : ''}`}
          >
            {/* Fila 1: nombre COMPLETO (envuelve si hace falta) + monto y %
                completos a la derecha. Fila 2: riel proporcional a lo ancho.
                Así ni el nombre ni el monto compiten por espacio en móvil. */}
            <span className="flex items-baseline justify-between gap-sm w-full">
              <span className="flex items-center gap-xs min-w-0 text-on-surface-variant">
                {d.icon && <span className="shrink-0 flex items-center"><Emoji e={d.icon} size={16} /></span>}
                <span className="break-words min-w-0">{d.name}</span>
              </span>
              <span className="shrink-0 flex items-baseline gap-sm">
                <span className="text-on-surface tabular-nums">{fmt(d.value)}</span>
                <span className="text-text-muted w-[34px] text-right tabular-nums">{pct0(d.pct)}</span>
              </span>
            </span>
            <span className="relative w-full h-1.5 rounded-full bg-surface-container-highest overflow-hidden">
              <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${maxValue > 0 ? (d.value / maxValue) * 100 : 0}%`,
                  background: d.color,
                  boxShadow: active === i ? `0 0 6px ${d.color}aa` : 'none',
                }}
              />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
