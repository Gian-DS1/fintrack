# Design decisions

Short write-ups of the non-obvious calls made while building FinTrack: what the
problem was, which options were on the table, and why the current behaviour is
what it is. Written as the work happened, not reconstructed afterwards.

| Date | Document | What it covers |
|------|----------|----------------|
| 2026-06-28 | [Presupuesto basado en el ingreso real](2026-06-28-presupuesto-ingreso-real.md) | Zero-based budgeting was computing "To Assign" against *estimated* income while every other figure used income *actually received*. Introduces `ingresoBase` and the fallback rule. |
| 2026-07-17 | [Línea de patrimonio · evidencia TDD](2026-07-17-wealth-line-chart-tdd.md) | RED → GREEN → UI cycle for the dashboard's liquid-wealth time series: 18 failing tests first, then the daily/monthly series, the pinnable point, and the chart itself. |
| 2026-11-17 | [Registro automático de gastos](2026-11-17-registro-automatico.md) | Why automatic expense logging is built on Apple Pay shortcuts and bank notification emails rather than a direct bank connection (open banking / aggregators / scraping evaluated for the Dominican Republic), plus the token model and the atomic cross-channel deduplication. |

> These are written in Spanish, the working language of the project.
