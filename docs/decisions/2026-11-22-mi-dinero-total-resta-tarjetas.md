# «Mi dinero total» y el patrimonio restan el saldo completo de las tarjetas

**Fecha:** 2026-11-22
**Estado:** Aprobado (implementado)
**Origen:** pregunta abierta P7 de la spec `docs/specs/2026-11-20-dinero-real-y-proyeccion.md`.

## Problema

La celda nueva «Dinero real» del Resumen dice cuánto te queda si hoy pagaras tus
tarjetas completas: efectivo − saldo pendiente completo (facturado + ciclo abierto −
abonos). Pero otras dos cifras seguían con reglas más laxas:

- **«Mi dinero total»** (hero del Resumen) = efectivo + ahorro − tarjetas por pagar, donde
  «por pagar» era solo lo **facturado** pendiente (`pendingBilled`). El consumo del
  ciclo abierto no restaba, así que el hero podía verse sano mientras el dinero real
  era negativo.
- **Patrimonio neto de «Mis finanzas»** = efectivo + ahorro − préstamos. No restaba las
  tarjetas en absoluto.

Tres números parecidos con tres reglas distintas en la misma app.

## Regla acordada

```
dinero real        = efectivo − saldo pendiente completo de tarjetas
mi dinero total    = efectivo + ahorro − saldo pendiente completo de tarjetas
                   = dinero real + ahorro
patrimonio neto    = efectivo + ahorro − préstamos − saldo pendiente completo de tarjetas
```

«Saldo pendiente completo» es `getCardOutstanding(...).owed`: facturado + ciclo abierto
− abonos, neto de cashback, con mínimo 0 por tarjeta. Una sola definición para las tres
cifras; la diferencia entre ellas es solo qué más suman o restan (ahorro, préstamos).

Alternativas descartadas:

- **Dejar el hero como estaba** (decisión provisional de la entrega 1): mantiene dos
  cifras casi iguales que se contradicen justo cuando importa (tarjetas > efectivo).
- **Restar solo lo facturado también en el dinero real:** oculta consumo ya hecho que
  saldrá del banco en el próximo pago.

## Cambios

### Lógica (`src/stitch/screens/dashboard/selectors.js`)

- `getCumulativeLiquidWealth` y `getWealthTimeline`: `cardsDue` pasa de `pendingBilled` a
  saldo completo. El saldo de cada punto se calcula **con lo registrado hasta ese día**:
  solo los consumos con fecha ≤ día y los abonos con fecha ≤ día (sin fecha: ya
  ocurrido, igual que en el efectivo). Así el punto de hoy coincide con
  `getRealMoney().realMoney + ahorro` y los puntos pasados no anticipan consumos ni
  abonos posteriores. En el último punto (hoy) entran todos los consumos, también los de
  fecha futura dentro del ciclo abierto, igual que en `getRealMoney`.
- `getNetWorth(transactions, initialCashBalance, cards, totalSaved, totalDebt, refDate)`:
  selector nuevo para «Mis finanzas»; reutiliza `getRealMoney`.

### Pantallas

- `PatrimonioSummary` usa `getNetWorth` y muestra una bolsa «Tarjetas por pagar» cuando
  hay saldo, para que el neto cuadre con lo que se ve.
- `WealthTrendChart` ya mostraba `head.cardsDue`; ahora es el saldo completo.

### Rótulos

- El hero del Resumen pasa de «Patrimonio neto» a **«Mi dinero total»** (`getHeroMetric().labelKey`). Antes dos cifras distintas se llamaban igual: el hero (no resta préstamos) y el patrimonio de «Mis finanzas» (sí los resta). El InfoTip del hero lo aclara.

### i18n (es/en)

- `dashboard.myMoneyTotalInfo` y `dashboard.creditCardsPayableInfo` dejan de hablar de
  «lo facturado» y dicen «facturado y ciclo abierto»; el primero aclara que no resta préstamos.
- Nueva `finances.cardsOwed` («Tarjetas por pagar» / «Cards to pay»).

## Límites conocidos

- **Movimientos con fecha futura:** el efectivo del Resumen (`getLiquidCash`) incluye
  movimientos con fecha posterior a hoy; la serie diaria no. Para los gastos con tarjeta
  esto ya está alineado en el punto de hoy; un ingreso o un gasto sin tarjeta con fecha
  futura sigue haciendo que el efectivo del punto difiera del de `getRealMoney`. Es una
  diferencia anterior a este cambio.
- **Estados legados (`paidCycles`):** se descuentan completos en cualquier fecha pasada,
  porque no llevan una fecha de pago fiable. Afecta solo a cuentas migradas.
- **Efecto visible:** para quien tiene consumo en el ciclo abierto, «Mi dinero total» baja
  (antes ese consumo no restaba) y el patrimonio de «Mis finanzas» baja por el saldo de
  tarjetas (antes no restaba). No hay migración de datos: solo cambia el cálculo.

## Pruebas

`selectors.test.js › Mi dinero total y patrimonio…`: el punto de hoy de la serie diaria y
de la mensual es igual a `getRealMoney().realMoney + ahorro` (con y sin abonos); cada
punto pasado usa los consumos y abonos de su día; un ingreso con `cardId` huérfano no
mueve las tarjetas; `getNetWorth` suma efectivo + ahorro − préstamos − tarjetas.
