// Curva del dinero real a 12 meses, con el estilo de WealthTrendChart (línea
// discontinua tertiary, grid sutil, tooltip píldora) más una línea de referencia en
// 0 y un marcador en el primer mes negativo. Solo presentación: recibe el resultado
// de projectRealMoney. El gráfico es una imagen para los lectores de pantalla
// (role="img" con resumen); la alternativa completa es ProjectionTable.
// Motion: un barrido de entrada (clip-path, una vez) que no corre con reduced-motion.
import { useLayoutEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';
import {
  ResponsiveContainer, ComposedChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine, ReferenceDot,
} from 'recharts';
import MS from '../../MS';
import { useI18n } from '../../../contexts/I18nContext';
import { formatCurrencyWhole, formatAmountCompact } from '../../../utils/formatters';
import { monthShort } from '../../../i18n/runtime';
import { CHART } from '../../chartTokens';
import { getNiceAxis } from './chartAxis';

const monthLabel = (p) => `${monthShort(p.m)} ${String(p.y).slice(2)}`;
// «170.0K» → «170K»: el eje no necesita decimales.
const axisTick = (v) => formatAmountCompact(v).replace(/\.0(?=[KMB]$)/, '').replace(/^(-?)0\.00$/, '0');

function ProjectionTip({ active, payload }) {
  const { t } = useI18n();
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  const negative = d.realMoney < 0;
  return (
    <div className="pointer-events-none rounded-full bg-surface-card border border-border-subtle inner-glow shadow-xl px-sm py-[5px] flex items-center gap-xs whitespace-nowrap">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: negative ? CHART.error : CHART.tertiary }} />
      <span className="font-mono-data text-mono-data text-text-muted uppercase">{d.label}</span>
      <span className={`font-headline-md text-[12px] tabular-nums ${negative ? 'text-accent-error' : 'text-on-surface'}`}>
        {formatCurrencyWhole(d.realMoney)}
      </span>
      {negative && (
        <span className="inline-flex items-center gap-[2px] font-label-sm text-label-sm text-accent-error">
          <MS name="warning" fill className="!text-[12px]" />
          {t('projection.negative')}
        </span>
      )}
    </div>
  );
}

export default function ProjectionChart({ start, points, firstNegativeKey }) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const frameRef = useRef(null);

  // Barrido revelador de izquierda a derecha, solo al montar (GPU, sin re-renders).
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el || reduced) return undefined;
    const anim = el.animate(
      [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }],
      { duration: 900, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
    return () => anim.cancel();
  }, [reduced]);

  const data = [
    { key: 'today', label: t('projection.today'), realMoney: start },
    ...points.map((p) => ({ key: p.key, label: monthLabel(p), realMoney: p.realMoney })),
  ];
  const axis = getNiceAxis(data.map((d) => d.realMoney));
  const labelByKey = new Map(data.map((d) => [d.key, d.label]));
  const negativePoint = firstNegativeKey ? data.find((d) => d.key === firstNegativeKey) : null;
  const summary = t('projection.chartLabel')
    .replace('{start}', formatCurrencyWhole(start))
    .replace('{end}', formatCurrencyWhole(points[points.length - 1].realMoney));

  return (
    <div
      ref={frameRef}
      role="img"
      aria-label={summary}
      className="h-[18rem] sm:h-[22rem] [&_*:focus:not(:focus-visible)]:outline-none"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART.outline} strokeOpacity={0.22} />
          <XAxis
            dataKey="key"
            tick={{ fill: CHART.muted, fontSize: 10 }}
            tickFormatter={(k) => labelByKey.get(k) ?? k}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis
            width={44}
            tick={{ fill: CHART.muted, fontSize: 10 }}
            tickFormatter={axisTick}
            axisLine={false}
            tickLine={false}
            domain={axis.domain}
            ticks={axis.ticks}
          />
          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: CHART.outline, strokeWidth: 1, strokeDasharray: '4 4' }}
            content={<ProjectionTip />}
          />
          <ReferenceLine y={0} stroke={CHART.muted} strokeOpacity={0.7} strokeDasharray="2 3" />
          <Line
            type="linear"
            dataKey="realMoney"
            stroke={CHART.tertiary}
            strokeWidth={2}
            strokeDasharray="4 4"
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            activeDot={{ r: 5, fill: CHART.tertiary, stroke: CHART.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
          {negativePoint && (
            <ReferenceDot x={negativePoint.key} y={negativePoint.realMoney} r={6} fill={CHART.error} stroke={CHART.surface} strokeWidth={2} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
