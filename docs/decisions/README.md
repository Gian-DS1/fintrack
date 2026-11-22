# Design decisions

Short write-ups of the non-obvious calls made while building FinTrack: what the
problem was, which options were on the table, and why the current behaviour is
what it is. Written as the work happened, not reconstructed afterwards.

| Date | Document | What it covers |
|------|----------|----------------|
| 2026-06-28 | [Presupuesto basado en el ingreso real](2026-06-28-presupuesto-ingreso-real.md) | Zero-based budgeting was computing "To Assign" against *estimated* income while every other figure used income *actually received*. Introduces `ingresoBase` and the fallback rule. |
| 2026-07-17 | [Línea de patrimonio · evidencia TDD](2026-07-17-wealth-line-chart-tdd.md) | RED → GREEN → UI cycle for the dashboard's liquid-wealth time series: 18 failing tests first, then the daily/monthly series, the pinnable point, and the chart itself. |
| 2026-11-22 | [«Mi dinero total» resta el saldo completo de tarjetas](2026-11-22-mi-dinero-total-resta-tarjetas.md) | The hero's total and the net worth in My Finances now subtract the full card balance (billed + open cycle), the same rule as the new "Real money" cell. Defines how each point of the time series is computed. |

> These are written in Spanish, the working language of the project.
