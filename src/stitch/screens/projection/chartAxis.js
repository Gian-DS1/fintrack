// Eje Y con marcas redondas (1, 2 o 5 × 10^n) que siempre incluye el 0, para que la
// línea de referencia en 0 tenga su marca. Función pura.
const TARGET_TICKS = 5;

export function getNiceAxis(values) {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = (max - min) || 1;
  const rough = span / (TARGET_TICKS - 1);
  const pow = 10 ** Math.floor(Math.log10(rough));
  const mult = [1, 2, 5, 10].find((m) => m * pow >= rough);
  const step = mult * pow;
  const lo = Math.floor(min / step) * step;
  let hi = Math.ceil(max / step) * step;
  if (hi === lo) hi = lo + step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return { ticks, domain: [ticks[0], ticks[ticks.length - 1]] };
}
