# Dinero real y proyección de flujo de caja

**Fecha:** 2026-11-20
**Estado:** Preguntas abiertas decididas el 2026-11-20. Entregas 1 y 2 implementadas; entrega 3 pendiente.
**Rama:** `feat/dinero-real-proyeccion`
**Tickets:** `.scratch/dinero-real-proyeccion/` (fuera del repo a propósito: `.scratch/` está en `.gitignore`)
**Glosario:** `GLOSSARY.md` (términos de esta feature)

> Todos los montos de este documento son ejemplos genéricos. No reflejan datos reales de ningún usuario.

---

## 1. Problema

- FinTrack calcula el **efectivo líquido** con `getLiquidCash` (`src/stitch/screens/dashboard/selectors.js`), que ignora a propósito los gastos con tarjeta (`if (t.cardId) continue`) hasta que se registra el pago del estado de cuenta. Como modelo del saldo del banco es correcto.
- Hay quien usa la tarjeta de crédito como extensión de su cuenta y la paga completa cada mes. Para esa persona, lo que cargó a la tarjeta es dinero que ya no tiene.
- Cuando el ingreso baja, el saldo de la tarjeta puede superar al efectivo sin que la app avise. Ejemplo: efectivo 40,000 y saldo de tarjeta 55,000. El dinero real es −15,000 y el próximo pago completo no se podrá cubrir.
- Hoy ninguna pantalla muestra esa resta:
  - El hero del Resumen («Mi dinero total») muestra `efectivo + ahorro − facturado pendiente`: no resta el **ciclo abierto** y el ahorro tapa el hueco.
  - «Mis finanzas» (`PatrimonioSummary`) muestra `efectivo + ahorro − préstamos`: no resta **nada** de tarjetas.
  - Los recordatorios avisan *cuándo* vence la tarjeta, no *si alcanza*.

## 2. Objetivos y no-objetivos

### Objetivos
1. Mostrar en el Resumen, siempre con la fecha de hoy, el **dinero real** = efectivo líquido − saldo pendiente de todas las tarjetas.
2. Hacer evidente el estado crítico (dinero real < 0) con icono y texto, no solo con color.
3. (Entrega 2) Responder «¿me alcanza hasta el próximo pago de la tarjeta?» con una lista de movimientos previstos y el saldo después de cada uno.
4. (Entrega 3) Proyectar el dinero real a 12 meses con escenarios y simular la cancelación de recurrentes **sin modificar datos**.
5. Derivar todo de los datos existentes. Ningún saldo nuevo se guarda en Supabase, igual que hoy.

### No-objetivos
- No cambia `getLiquidCash` ni su regla: el efectivo sigue modelando el banco.
- No cambia «Mi dinero total» del hero ni `PatrimonioSummary` (ver Pregunta abierta 7).
- No modela intereses, pagos mínimos ni financiamiento de la tarjeta: se asume que se paga el saldo completo.
- No hay alertas push ni correo para el dinero real negativo (podría venir después).
- No hay conversión de moneda: la app es de una sola moneda por perfil.
- La proyección no hace predicciones estadísticas avanzadas: usa promedios simples.

## 3. Glosario breve

| Término | Definición | Fuente |
|---|---|---|
| **Efectivo líquido** | Saldo derivado del banco: saldo inicial + ingresos − gastos sin tarjeta (netos de cashback) − apartados a ahorro − abonos a tarjeta. | `getLiquidCash` (existe) |
| **Saldo pendiente de tarjeta** | Todo lo que se debe hoy en una tarjeta: facturado pendiente + ciclo abierto − abonos, con mínimo 0. Neto de cashback plano. | `getCardBalances(...).totalBalance` (existe) |
| **Facturado pendiente** | Solo la parte ya cortada y sin pagar (`pendingBilled`). Es lo que hoy resta «Mi dinero total». **No** es el saldo pendiente. | existe |
| **Dinero real** | Efectivo líquido − Σ saldo pendiente de todas las tarjetas. No incluye ahorro ni préstamos. | nuevo |
| **Faltante** | Lo que falta para cubrir un pago con el efectivo disponible en ese momento: `max(0, monto − disponible)`. En la entrega 1, faltante = `max(0, −dinero real)`. | `getCashShortfall` (existe; ver §5.3) |
| **Pago completo de tarjeta** | Pago previsto en la fecha de pago de una tarjeta por el saldo del estado de cuenta correspondiente. | nuevo (entrega 2) |
| **Gasto variable base** | Gasto variable mensual que la proyección asume: el promedio de 3 meses completos o un valor manual. | nuevo (entrega 3) |
| **Escenario** | Juego de supuestos de la proyección: «como vas», «solo lo esencial», «con recortes». | nuevo (entrega 3) |

---

## 4. Entrega 1 · Dinero real en el Resumen (detallada, lista para implementar)

### 4.1 Comportamiento

- Nueva celda **«Dinero real»** al inicio del grid del Resumen, antes del hero, a todo el ancho (`col-span-2 md:col-span-12`).
- Siempre se calcula **con la fecha de hoy** (`now` del dashboard). No le afectan el mes seleccionado, el punto fijado en la línea ni el scrubbing.
- Contenido en estado normal:
  - Rótulo «Dinero real» + `InfoTip`: «Tu efectivo menos todo lo que debes en tus tarjetas (lo facturado y lo del ciclo abierto). Es lo que te queda si hoy pagaras tus tarjetas completas.»
  - Número grande (tipografía del número del hero, `tabular-nums`, color neutro `text-on-surface`).
  - Fila secundaria: «Efectivo RD$100,000 · Saldo de tarjetas −RD$40,000».
- Estado **crítico** (dinero real < 0 tras redondear a centavos):
  - Icono `MS name="warning"` (con `aria-hidden`) antes del número, número en `text-accent-error`.
  - Texto visible (es la señal principal; no depende del color): «Tus tarjetas superan tu efectivo por RD$15,000. Si pagas el saldo completo, no te alcanza.»
  - Si el ahorro total (Σ `goal.currentAmount`) cubre el faltante (`canAffordPayment(cash, ahorro, cardsOwed)`), se añade la línea «Tu ahorro alcanza para cubrirlo.». Si no lo cubre: «Ni con tu ahorro alcanza.»
  - Enlace «Ver tarjetas» → `/mis-finanzas?tab=cards`.
- Sin tarjetas registradas: la celda muestra el dinero real (= efectivo) y omite «Saldo de tarjetas».
- Con tarjetas sin día de corte/pago válido: nota discreta «{n} tarjeta(s) sin día de corte: se resta todo su saldo» con enlace a tarjetas.
- Modo demo: funciona igual, con los stores sembrados por `demoMode.js` y sin red.

### 4.2 Reglas de cálculo

```
dineroReal = getLiquidCash(transactions, initialCashBalance, cards)
           − Σ_card getCardOutstanding(card, transactions, hoy).owed
```

| Caso | Regla |
|---|---|
| Tarjeta con ciclo válido (`cutoffDay` y `dueDay` enteros 1–31) | `owed = getCardBalances(card, txs, hoy).totalBalance`: facturado (incluye `openingBalance` y arrastrado) + ciclo abierto − abonos (`payments` + `paidCycles` legados), neto de cashback plano, mínimo 0. |
| Tarjeta **sin ciclo válido** (corte o pago ausente, 0 o `NaN`) | Hoy `getCardCycles` genera fechas vacías y `getCardBalances` devolvería **solo** `openingBalance − abonos`, ignorando todo el consumo. Regla nueva: `owed = max(0, openingBalance + Σ consumo neto de la tarjeta con fecha ≤ hoy − Σ card.payments − Σ paidCycles legados con monto)`. Se marca `hasValidCycle: false`. |
| Pago parcial | Reduce `owed` por su monto (ya lo hace `getCardBalances` vía `payments`). El efectivo ya lo restó `getLiquidCash`. |
| Sobrepago (saldo a favor en la tarjeta) | `owed = 0` (no suma al dinero real). Es una decisión conservadora: el saldo a favor no se puede retirar como efectivo. |
| Varias tarjetas | Suma de `owed` de cada una. El detalle por tarjeta se devuelve para la UI y los tests. |
| Consumos con fecha futura | Con ciclo válido, entran si caen en el ciclo abierto (misma regla que la página de Tarjetas). Sin ciclo válido, solo hasta hoy. |
| Cashback escalonado (`tiers`) | **No** se descuenta (tampoco lo hace `getCardBalances`). Se mantiene una sola fuente de verdad (ver riesgos). |
| Sin transacciones | `dineroReal = initialCashBalance − Σ openingBalance + Σ abonos`; con todo en 0 → 0, estado normal. |
| `initialCashBalance` indefinido | Se trata como 0 (igual que `getLiquidCash`). |
| Multimoneda | No aplica: transacciones y tarjetas están en la moneda del perfil (`globalize_single_currency.sql`). No se convierte nada. |
| Préstamos | **No** se restan (ver Pregunta abierta 4). |
| Ahorro | **No** se suma: el dinero real es lo disponible sin tocar las metas. Solo se usa para el mensaje «Tu ahorro alcanza». |
| Redondeo | `isCritical = Math.round(dineroReal * 100) < 0`. Evita marcar como crítico un −0.004 de coma flotante. |

### 4.3 Funciones puras propuestas

**`src/utils/creditCards.js`** (junto a `getCardBalances`, que sigue siendo la fuente de verdad):

```js
/**
 * Saldo pendiente TOTAL de una tarjeta hoy (lo que habría que pagar para dejarla en 0).
 * Con ciclo válido delega en getCardBalances(...).totalBalance; sin ciclo válido
 * suma todo el consumo neto hasta refDate (ver regla en la spec).
 * @returns {{ owed: number, hasValidCycle: boolean }}
 */
export function getCardOutstanding(card, transactions = [], refDate = new Date())

/** ¿La tarjeta tiene día de corte y de pago válidos (enteros 1–31)? */
export function hasValidCardCycle(card)
```

**`src/stitch/screens/dashboard/selectors.js`**:

```js
/**
 * Dinero real de hoy = efectivo líquido − saldo pendiente de todas las tarjetas.
 * @returns {{
 *   cash: number,            // getLiquidCash
 *   cardsOwed: number,       // Σ owed
 *   realMoney: number,       // cash − cardsOwed
 *   isCritical: boolean,     // realMoney < 0 (a centavos)
 *   shortfall: number,       // −realMoney si es crítico (a centavos); si no, 0
 *   cards: Array<{ id: string, name: string, owed: number, hasValidCycle: boolean }>,
 *   cardsWithoutCycle: number
 * }}
 */
export function getRealMoney(transactions, initialCashBalance, cards, refDate = new Date())
```

- `getLiquidCash` no se toca.
- `getCashShortfall` no se toca en esta entrega.

### 4.4 Criterios de aceptación (verificables como tests)

Tests unitarios (Vitest, `environment: node`) en `creditCards.test.js` y `selectors.test.js`:

1. **Ejemplo del problema:** efectivo 40,000 (saldo inicial, sin gastos en efectivo) y una tarjeta con 55,000 de consumo → `realMoney = −15,000`, `isCritical = true`, `shortfall = 15,000`.
2. **Sano:** efectivo 100,000 y tarjeta 40,000 → `realMoney = 60,000`, `isCritical = false`, `shortfall = 0`.
3. **Ciclo abierto cuenta:** un consumo posterior al último corte (ciclo abierto) sí resta del dinero real, aunque «Tarjetas por pagar» del hero (facturado pendiente) no lo incluya.
4. **Pago parcial:** consumo 30,000 y abono 10,000 → `owed = 20,000`; el efectivo ya bajó 10,000; `realMoney` refleja ambos.
5. **Sobrepago:** abono mayor que el saldo → `owed = 0` (nunca negativo).
6. **Varias tarjetas:** `cardsOwed` = suma de cada `owed`; `cards` trae una entrada por tarjeta con su nombre.
7. **Sin ciclo válido:** tarjeta con `cutoffDay` `NaN` o 0 y consumo 5,000 → `owed = 5,000`, `hasValidCycle = false`, `cardsWithoutCycle = 1`. Con `NaN`, `getCardBalances` devuelve 0 (test de regresión). Con `0`, `Date` interpreta el día 0 como el último día del mes anterior y `getCardBalances` sí cuenta el consumo, pero por un ciclo falso; el ciclo se sigue marcando inválido.
8. **Saldo inicial de tarjeta:** `openingBalance` 8,000 sin consumos → `owed = 8,000`.
9. **Cashback plano:** consumo 10,000 con `cashbackEarned` 100 → `owed = 9,900` (igual que la página de Tarjetas).
10. **Sin datos:** `getRealMoney([], 0, [])` → todos los montos en 0, `isCritical = false`, `cards = []`.
11. **Sin tarjetas:** `realMoney === cash`.
12. **Coma flotante:** un `realMoney` de −0.004 no es crítico.
13. **Consistencia:** para tarjetas con ciclo válido, `getCardOutstanding(...).owed === getCardBalances(...).totalBalance`.

Criterios de UI (verificación manual + e2e Playwright en modo demo):

14. La celda «Dinero real» aparece primero en el Resumen, con el número, el efectivo y el saldo de tarjetas.
15. Al fijar un punto de la línea o cambiar de mes, la celda no cambia.
16. En estado crítico se ven el icono de advertencia **y** el texto «Tus tarjetas superan tu efectivo por …». El estado se entiende con el color desactivado (escala de grises).
17. Textos en es y en; ninguna cadena fija en el JSX.
18. En 375 px de ancho no hay scroll horizontal y los montos no se cortan (mismo `clamp` que `PatrimonioSummary`).
19. Con `prefers-reduced-motion`, sin animación de conteo.

### 4.5 Cambios de UI e i18n

- **Nuevo componente** `src/stitch/screens/dashboard/RealMoneyCard.jsx`. Es solo presentación: recibe el resultado de `getRealMoney` y el ahorro total.
- **`StitchDashboard.jsx`:** `useMemo(() => getRealMoney(transactions, initialCashBalance, cards, now))` y el nuevo `Stagger.Item` antes del hero. Hoy `initialCashBalance` ya se lee ahí.
- **Estilo:** tokens existentes (`BentoCell`, `font-mono-data` para rótulos, `text-accent-error` para el estado crítico, `InfoTip`). Para el motion se usan `StitchMotion`/`motionTokens.js` (filosofía Emil Kowalski ya adoptada en el repo): entrada con el `Stagger` del grid, sin animaciones nuevas.
- **Accesibilidad:** el icono lleva `aria-hidden` y el texto crítico es texto real. Nada de `aria-live` (el valor no cambia en vivo). El enlace se puede usar con teclado.
- **i18n** (`src/i18n/translations.js`, bloques `dashboard` es/en), claves nuevas:

| Clave | es | en |
|---|---|---|
| `dashboard.realMoney` | Dinero real | Real money |
| `dashboard.realMoneyInfo` | Tu efectivo menos todo lo que debes en tus tarjetas (lo facturado y lo del ciclo abierto). Es lo que te queda si hoy pagaras tus tarjetas completas. | Your cash minus everything you owe on your cards (billed and current cycle). It's what you'd have left if you paid your cards in full today. |
| `dashboard.cash` | Efectivo | Cash |
| `dashboard.cardBalance` | Saldo de tarjetas | Card balance |
| `dashboard.realMoneyCritical` | Tus tarjetas superan tu efectivo por {amount}. Si pagas el saldo completo, no te alcanza. | Your cards exceed your cash by {amount}. If you pay the full balance, you won't have enough. |
| `dashboard.realMoneySavingsCover` | Tu ahorro alcanza para cubrirlo. | Your savings can cover it. |
| `dashboard.realMoneySavingsShort` | Ni con tu ahorro alcanza. | Not even your savings cover it. |
| `dashboard.seeCards` | Ver tarjetas | See cards |
| `dashboard.cardsWithoutCycle` | {n} tarjeta(s) sin día de corte: se resta todo su saldo. | {n} card(s) without a statement day: their full balance is subtracted. |

- **Modo demo:** la tarjeta demo (`cc1`) acumula 6 meses de consumo **sin ningún abono**: la tarjeta arrastraría meses sin pagar, algo irreal. Se añaden al seed abonos por cada estado de cuenta ya vencido (el último, si aún no vence, queda pendiente y conserva el recordatorio). *Hallazgo al implementar:* el demo no saldría en estado crítico aun sin abonos (su efectivo es muy superior al consumo con tarjeta), así que los abonos sirven al realismo, no a evitar el estado crítico. `demoMode.test.js` fija que el demo no arranca crítico en varias fechas y que la tarjeta no arrastra ciclos sin pagar.

### 4.6 Riesgos (entrega 1)

- **Dos cifras parecidas en la misma pantalla:** «Mi dinero total» (hero) y «Dinero real» usan reglas distintas (ahorro sí/no; facturado vs saldo total). Mitigación: rótulos e `InfoTip` explícitos, y la Pregunta abierta 7.
- **Pagos legados en `paidCycles`:** reducen el saldo de la tarjeta, pero `getLiquidCash` solo resta `card.payments`. En cuentas migradas, el efectivo podría estar inflado por esos pagos antiguos. Es preexistente; conviene verificarlo con datos reales antes de culpar al nuevo número.
- **Cashback escalonado** no descontado: el dinero real puede ser un poco más pesimista que el estado de cuenta real. Queda así por coherencia con la página de Tarjetas.
- **Rendimiento:** `getCardBalances` recorre todas las transacciones por tarjeta. Una llamada por tarjeta y render memoizado es despreciable frente a `getWealthTimeline`, que ya lo hace por día.

---

## 5. Entrega 2 · Calendario hasta el próximo pago de tarjeta

### 5.1 Comportamiento

- Dentro de la celda «Dinero real», un disclosure: «¿Me alcanza hasta el {fecha}?» (cerrado por defecto) muestra una lista ordenada por fecha:
  - ingresos recurrentes
  - gastos recurrentes
  - cuotas de préstamos
  - el **pago completo** de cada tarjeta
- Cada fila: fecha, etiqueta, monto con signo y **efectivo restante** después del movimiento.
- Al pie: efectivo al final del horizonte y, si lo hay, **faltante** del primer pago que no se puede cubrir: «El {fecha} te faltarán RD$X para pagar {tarjeta}».
- Las filas con saldo negativo llevan icono + texto «sin fondos», no solo color.
- La lista es de **efectivo** (lo que hay en el banco en cada fecha), no de dinero real: es la vista que dice si el pago se puede hacer ese día.

### 5.2 Reglas de cálculo

- **Inicio:** `getLiquidCash` hoy.
- **Horizonte:** la fecha de pago más lejana entre los *próximos pagos* de cada tarjeta con saldo (cada tarjeta aparece una vez), con tope de 45 días. Sin tarjetas con saldo: 30 días.
- **Pago de cada tarjeta** (supuesto: se paga el saldo completo, nunca el mínimo):
  - Estado cerrado sin pagar y con fecha de pago ≥ hoy → pago en `cycles.dueDateISO` por `pendingBilled`.
  - Estado cerrado sin pagar y fecha de pago ya pasada (vencido) → pago **hoy**, marcado `overdue`.
  - Estado cerrado ya pagado → pago en la fecha de pago del ciclo abierto por `openCycle` + cargos recurrentes previstos con esa tarjeta hasta el próximo corte («monto del ciclo cerrado + compras hasta el corte»). Si no hay nada que pagar (ciclo abierto en 0 y sin cargos recurrentes), la tarjeta no genera pago.
  - Con el estado cerrado **sin pagar**, los cargos recurrentes con tarjeta caen en el ciclo abierto (posterior al corte ya pasado), así que **no** engordan ese pago.
  - Tarjeta **sin ciclo válido**: no hay fecha de pago, así que no genera pago previsto (sí entra en el dinero real).
  - Un pago que cae después del tope de 45 días queda fuera de la lista y no cuenta para el faltante.
- **Recurrentes** (`useRecurringStore`, solo `active`): se expanden ocurrencias desde `nextDate` con `advanceDate` hasta el horizonte (una semanal genera varias). Las ocurrencias < hoy se ignoran porque `materializeDue` las convierte en transacciones al cargar.
  - `income` suma.
  - Gasto **sin** `cardId` resta.
  - Gasto **con** `cardId` no mueve efectivo: se suma al pago de su tarjeta si cae antes de ese corte.
  - `savings` resta.
- **Préstamos** (`useDebtStore`, `status === 'active'`, con `due_date` y `monthlyPayment > 0`): primera fecha con `getNextLoanDueDate(debt, payments, hoy)` y las siguientes con `nextMonthlyOccurrence(debt.due_date, día siguiente)` dentro del horizonte. Se ancla al día del préstamo y no se usa `advanceDate` sobre la fecha anterior: así un préstamo del día 31 no se arrastra al 28 después de febrero. La suma de cuotas se topa por `currentBalance`: la última se reduce al saldo que queda y no hay más después. Se omiten los préstamos con `currency` ≠ moneda del perfil y se avisa con una nota.
- **Orden dentro del mismo día:** ingresos → préstamos → gastos recurrentes → pagos de tarjeta. Así el pago de la tarjeta se evalúa con todo lo demás del día ya aplicado.
- **Faltante:** para cada pago de tarjeta, `max(0, monto − saldo antes del pago)`.

### 5.3 Funciones puras propuestas

**Prefactor (expand) en `selectors.js`:** `getCashShortfall` solo compara contra el efectivo de **hoy**. No se puede reusar tal cual para un pago futuro, así que se extrae su núcleo y `getCashShortfall` pasa a usarlo sin cambiar su comportamiento ni sus tests:

```js
/** Faltante para cubrir `amount` con `available`: { available, shortfall }. */
export function computeShortfall(available, amount)
```

**Nuevo `src/utils/cashflowProjection.js`:**

```js
/**
 * @typedef {'income'|'recurring_expense'|'savings'|'loan'|'card_payment'} CashflowKind
 * @typedef {{ dateISO: string, kind: CashflowKind, label: string, amount: number,
 *             balanceAfter: number, shortfall: number, overdue?: boolean,
 *             sourceId: string }} CashflowEvent   // amount con signo
 */

/** Ocurrencias de una plantilla recurrente en [fromISO, toISO]. */
export function expandRecurring(template, fromISO, toISO)

/**
 * Pago completo previsto de una tarjeta (ver reglas 5.2).
 * @returns {{ dateISO: string, amount: number, overdue: boolean } | null}
 */
export function getNextCardPayment(card, transactions, recurring, refDate)

/**
 * Movimientos previstos hasta el próximo pago de tarjeta, con saldo corrido.
 * @returns {{ horizonISO: string, startCash: number, events: CashflowEvent[],
 *             endCash: number, minCash: number, firstShortfall: CashflowEvent | null,
 *             skippedDebts: string[] }}
 */
export function getCashflowUntilCardDue({ transactions, initialCashBalance, cards,
  recurring, debts, debtPayments, currency, refDate })
```

### 5.4 Criterios de aceptación

1. `expandRecurring` semanal a 20 días → 3 ocurrencias; mensual del día 31 en febrero → último día del mes (lo hace `advanceDate`).
2. Recurrente inactivo → no aparece.
3. Gasto recurrente con `cardId` → no resta efectivo y aumenta el pago de su tarjeta si cae antes del corte.
4. Estado cerrado sin pagar → pago en `dueDateISO` por `pendingBilled`. Estado ya pagado → pago siguiente por `openCycle` + recurrentes de la tarjeta.
5. Estado vencido sin pagar → pago hoy con `overdue: true`.
6. Préstamo con la cuota de este ciclo ya pagada → aparece la del mes siguiente (si cabe en el horizonte).
7. Préstamo en otra moneda → excluido y listado en `skippedDebts`.
8. Ejemplo del problema: efectivo 40,000, ingreso recurrente 30,000 antes del pago y pago de tarjeta de 55,000 → `firstShortfall = null` y `endCash = 15,000` (alcanza). Con un ingreso de 10,000 → `firstShortfall.shortfall = 5,000` y `endCash = −5,000`.
9. Orden estable: mismo día → ingreso antes que pago de tarjeta.
10. `getCashShortfall` conserva todos sus tests actuales tras el prefactor.
11. UI: el disclosure se puede usar con teclado (`button` + `aria-expanded`). Las filas negativas tienen icono + texto. Hay i18n es/en.

### 5.5 Riesgos

- Ingresos **no** registrados como recurrentes no aparecen: la lista puede ser pesimista. Hay que decirlo en el pie: «Solo incluye movimientos programados».
- `cashflowProjection.js` (en `src/utils`) importa `getLiquidCash` y `computeShortfall` de `dashboard/selectors.js`, como fija §5.3: es la única dependencia de `utils` hacia `stitch`. Si se mueve el efectivo a `utils`, el import se invierte sin más cambios.
- **Límite conocido (a) · doble conteo transitorio de la ocurrencia de hoy:** `materializeDue` crea las transacciones y solo después avanza `nextDate` (en Supabase y luego en el estado). Mientras espera a Supabase, la ocurrencia de hoy ya está en las transacciones y la plantilla todavía dice «hoy», así que la lista la cuenta dos veces. Se corrige sola al avanzar `nextDate`; no se arregla en esta entrega.
- **Límite conocido (b) · día de corte con un recurrente de tarjeta sin materializar:** si hoy es día de corte y la ocurrencia de hoy de un gasto recurrente con tarjeta aún no se materializó, se suma al pago del estado siguiente. Una vez materializada, esa compra (con fecha de hoy) cae en el estado que cierra hoy. No se arregla en esta entrega.
- Un pago de tarjeta que cae después del tope de 45 días no entra en la lista; la UI lo avisa («N pago(s) de tarjeta caen fuera de este plazo») y no afirma que alcanza para todas las tarjetas.
- Los cargos recurrentes con tarjeta se suman por su monto bruto, sin cashback (los recurrentes no guardan cashback): el pago previsto puede ser algo más pesimista.
- `getUpcoming` (calendario) ya lista vencimientos con otra regla (una ocurrencia por recurrente y `pendingBilled`). No se fusionan ahora para no tocar el calendario. Se anota como deuda técnica.

---

## 6. Entrega 3 · Pantalla «Proyección» a 12 meses

### 6.1 Comportamiento (con la recomendación de la Pregunta 1: pantalla propia)

- Ruta nueva `/proyeccion`, entrada en la navegación (icono `insights`) y enlace «Ver proyección» desde la celda «Dinero real».
- Cabecera fija: **«Simulación: nada de lo que cambies aquí modifica tus datos.»**
- Curva del **dinero real** al cierre de cada mes, desde hoy hasta 12 meses. Línea en 0 de referencia. Estilo visual de `WealthTrendChart` (Recharts, `chartTokens.js`).
- Selector segmentado de escenario: **Como vas** · **Solo lo esencial** · **Con recortes**.
- Si la curva cruza 0, un marcador y un texto: «En {mes} tu dinero real pasa a negativo». Si no cruza: «En 12 meses tendrías RD$X».
- Panel «Simular cancelaciones»: lista de recurrentes de gasto activos con su equivalente mensual y un interruptor. Al apagarlo se recalcula la curva y se muestra «+RD$X/mes».
- «Gasto variable base»: muestra el promedio y los meses usados («promedio de 3 meses: RD$X»), con campo para corregirlo a mano y «restablecer».
- El estado de la simulación (interruptores, corrección manual, % de recorte, categorías esenciales) se guarda solo en `localStorage` del dispositivo, con `try/catch`.

### 6.2 Reglas de cálculo

- **Punto 0:** dinero real de hoy (`getRealMoney`).
- **Por mes `k`** (el mes en curso cuenta solo desde hoy):
  - `+` ingresos recurrentes del mes (ocurrencias con `expandRecurring`).
  - `−` gastos recurrentes del mes, **con o sin tarjeta**: en dinero real da igual el medio de pago, ese es el punto de esta métrica.
  - `−` recurrentes `savings`.
  - `−` cuotas de préstamos activos, hasta agotar `currentBalance` (número de cuotas = `ceil(currentBalance / monthlyPayment)`; intereses ignorados, se documenta).
  - `−` gasto variable base del escenario (en el mes en curso, prorrateado por los días que quedan).
  - `−` **fijos no programados** = `max(0, promedio de 3 meses de fixed_expense − equivalente mensual de los recurrentes fixed_expense activos)`. Así un alquiler no registrado como recurrente no desaparece de la proyección.
- **Gasto variable base** (`getAverageVariableSpend`): promedio de los últimos 3 meses **completos** (sin el mes en curso) de `variable_expense` y `expense` (legado), netos de cashback (`getEffectiveAmount`), con o sin tarjeta. Si hay menos de 3 meses completos, usa los disponibles. Con 0 meses devuelve `average: 0`, `monthsUsed: 0`, y la UI pide un valor manual.
- **Escenarios:**
  - **Como vas:** base = promedio (o la corrección manual).
  - **Solo lo esencial:** base = promedio solo de las categorías marcadas como esenciales (ver Pregunta 6).
  - **Con recortes:** base × (1 − recorte). El recorte se elige entre 10 % y 50 %; por defecto 20 %.
- **Cancelaciones simuladas:** los ids de recurrentes apagados se excluyen en **todos** los escenarios.
- **Equivalente mensual:** semanal × 52/12, quincenal × 26/12, mensual × 1.

### 6.3 Funciones puras propuestas (`src/utils/cashflowProjection.js`)

```js
/** Promedio mensual de gasto por tipo en los últimos `months` meses completos. */
export function getAverageMonthlySpend(transactions, refDate,
  { months = 3, types = ['variable_expense', 'expense'], categoryIds = null } = {})
  // → { average: number, monthsUsed: number }

/** Equivalente mensual de una plantilla recurrente. */
export function monthlyEquivalent(template)

/**
 * Curva de dinero real a N meses.
 * @returns {{ start: number,
 *   base: { variable: number, variableMonthsUsed: number, fixedUnscheduled: number },
 *   points: Array<{ key: string, y: number, m: number, income: number,
 *                   recurringOut: number, loanOut: number, variableOut: number,
 *                   realMoney: number }>,
 *   firstNegativeKey: string | null, minPoint: object }}
 */
export function projectRealMoney({ transactions, initialCashBalance, cards, recurring,
  debts, debtPayments, currency, refDate, months = 12,
  scenario = 'current',               // 'current' | 'essential' | 'cuts'
  excludedRecurringIds = [], variableOverride = null,
  essentialCategoryIds = [], cutPct = 0.2 })
```

### 6.4 Criterios de aceptación

1. Sin recurrentes, préstamos ni historial: la curva es plana en el dinero real de hoy.
2. Ingreso recurrente mensual 50,000 y variable base 30,000 → la curva sube 20,000 por mes completo.
3. Apagar un recurrente de 2,000/mes sube el punto 12 en 24,000 (o el prorrateo exacto del mes en curso).
4. Préstamo con 3 cuotas restantes → resta solo en 3 meses.
5. «Con recortes» al 20 % con base 30,000 → resta 24,000 por mes.
6. `getAverageMonthlySpend` ignora el mes en curso y los meses previos al primer dato, y devuelve `monthsUsed` correcto con 0, 1, 2 y 3+ meses.
7. Cambiar interruptores no llama a ningún store ni a Supabase. Test: la función es pura y la pantalla no importa acciones de escritura.
8. `firstNegativeKey` es el primer mes con `realMoney < 0`.
9. UI: el selector de escenario y los interruptores funcionan con teclado. El cruce a negativo se comunica con texto. Hay i18n es/en. En 375 px no hay scroll horizontal. La animación de la curva respeta `prefers-reduced-motion`.
10. Modo demo: la pantalla funciona con los datos sembrados.

### 6.5 Riesgos

- **Falsa precisión:** una curva a 12 meses parece una promesa. Mitigación: rotular «estimación», mostrar los supuestos (meses usados, intereses ignorados) y no dar decimales.
- **Ingreso irregular:** si el ingreso no está como recurrente, la proyección cae en picada. Mitigación: aviso «No hay ingresos recurrentes; la proyección asume 0».
- **Ingresos restringidos** (Pregunta 3) inflan la curva si están registrados como recurrente de ingreso. El interruptor de simulación sirve de parche manual.
- **Duplicidad fijos/recurrentes:** la regla de «fijos no programados» puede contar doble si un fijo recurrente cambió de monto. Mitigación: se muestra como línea propia y se puede poner a 0.

---

## 7. Esquema de Supabase

- **Entregas 1 y 2: ningún cambio.** Todo se deriva de `transactions`, `credit_cards` (`payments`, `paid_cycles`, `opening_balance`), `recurring_transactions`, `debts`, `debt_payments` y `profiles.initial_cash_balance`.
- **Entrega 3: ningún cambio** si la simulación se guarda en `localStorage` (recomendado). Sincronizarla entre dispositivos requeriría una columna `jsonb` en `profiles`: se deja para después.
- **Ingresos restringidos:** solo cambiaría el esquema si se elige la opción de modelo propio (Pregunta 3).

## 8. Seams de prueba

- Un solo seam por entrega, en funciones puras: `getRealMoney` (entrega 1), `getCashflowUntilCardDue` (entrega 2), `projectRealMoney` (entrega 3). Los componentes solo presentan.
- Antecedentes en el repo: `selectors.test.js` (`getLiquidCash`, `getCardReminders`), `creditCards.test.js`, `loanReminders.test.js`, `recurrence.test.js`. Las fechas se fijan con un `refDate` explícito, nunca con `new Date()` dentro del test.
- Vitest corre en `node` (sin DOM), así que la UI se valida con Playwright en modo demo (`tests/dashboard.e2e.spec.js` como referencia).

## 9. Skills Plug & Play usadas

- No hay skills de estética o animación instaladas (`impeccable`, `taste`, `motion`, `ui-*`) en `.claude/skills/`, `.agents/skills/` ni `~/.claude/skills/`.
- Se aplicaron `frontend-ui-engineering` (accesibilidad, estados, responsive) y `api-and-interface-design` (firmas puras y estables).
- Para el motion se siguen los criterios de Emil Kowalski que el repo ya codifica en `src/stitch/motionTokens.js` y `StitchMotion.jsx`.

---

## 10. Preguntas abiertas (decididas el 2026-11-20)

El usuario aprobó la recomendación en las siete preguntas. Cada una conserva su contexto y añade la **Decisión**.

### P1 · ¿Dónde vive la proyección?

**Decisión (2026-11-20):** pantalla propia `/proyeccion`, con enlace «Ver proyección» desde el Resumen. Afecta a la entrega 3; la entrega 1 no añade el enlace.

- **Qué decides:** si la curva a 12 meses tiene su propia pantalla (`/proyeccion`) o es una sección más del Resumen.
- **Qué cambia:** una pantalla propia mantiene el Resumen ligero y da espacio a escenarios e interruptores. Una sección del Resumen se ve sin navegar, pero recarga una pantalla que ya tiene hero, donut y recordatorios.
- **Recomendación:** pantalla propia, y en el Resumen solo «Dinero real» con enlace a la proyección. Los controles de simulación necesitan espacio y no deben confundirse con datos reales.

### P2 · ¿Base del gasto variable?

**Decisión (2026-11-20):** promedio automático de 3 meses completos, editable a mano, con botón «restablecer». Entrega 3.

- **Qué decides:** de dónde sale el gasto variable mensual que asume la proyección.
- **Qué cambia:** el promedio automático se actualiza solo, pero arrastra meses atípicos. Un monto manual es exacto, pero se queda viejo si no lo actualizas.
- **Ojo:** el «promedio de 3 meses del presupuesto» ya **no existe** en el código. Se eliminó junto con el presupuesto sugerido, así que hay que crearlo (`getAverageMonthlySpend`).
- **Recomendación:** promedio automático de 3 meses completos con corrección manual y botón «restablecer». Arranca sin trabajo y deja corregir un mes atípico.

### P3 · ¿Cómo tratar ingresos restringidos (p. ej. un bono que solo sirve en un supermercado)?

**Decisión (2026-11-20):** opción (a). El bono de uso restringido no se registra como ingreso por ahora; sin código ni migración. El interruptor de la proyección queda como parche manual. Si el caso se vuelve frecuente, el monedero propio (c) iría como feature aparte con ADR.

- **Qué decides:** cómo evitar que ese dinero cuente como efectivo, si hoy se registra como `income`.
- **Opciones:**
  - (a) Convención sin código: no registrarlo como ingreso, y los gastos pagados con él tampoco (o registrarlos y anotarlos aparte).
  - (b) Marca «restringido» en la transacción o la categoría: requiere migración y excluirlo en `getLiquidCash`.
  - (c) Modelarlo como un «monedero» propio, parecido a una tarjeta prepago: es lo más correcto y lo más caro.
- **Recomendación:** (a) para estas tres entregas, más el interruptor de la proyección para excluir ese recurrente. Si el caso es frecuente, (c) como feature aparte con ADR. Evita migraciones ahora y no contamina la regla del efectivo.

### P4 · ¿El dinero real resta también el saldo de los préstamos?

**Decisión (2026-11-20):** no. El dinero real resta solo el saldo de tarjetas; los préstamos se ven por cuotas en las entregas 2 y 3.

- **Qué decides:** si los préstamos entran en la resta igual que las tarjetas.
- **Qué cambia:** si se restan, un préstamo de auto a 5 años dejaría el dinero real siempre muy negativo y la señal de alarma perdería sentido. Si no se restan, se ven por cuotas en el calendario (entrega 2) y la proyección (entrega 3).
- **Recomendación:** no restarlos. La tarjeta se paga completa cada mes y los préstamos por cuotas, así que son deudas de naturaleza distinta.

### P5 · ¿Cambios en el esquema de Supabase?

**Decisión (2026-11-20):** sin cambios de esquema. Todo se deriva; la simulación de la proyección se guarda solo en `localStorage`.

- **Qué decides:** si se guarda algo nuevo o todo se deriva.
- **Qué cambia:** derivar mantiene una sola fuente de verdad, como hoy con efectivo y saldos de tarjeta. Guardar abre la puerta a descuadres.
- **Recomendación:** derivar todo. La simulación de la proyección se guarda solo en el dispositivo (`localStorage`). No hace falta migración en ninguna de las tres entregas.

### P6 · ¿Qué es «lo esencial»? (nueva)

**Decisión (2026-11-20):** las categorías esenciales se eligen en la pantalla de proyección y se guardan en el dispositivo. Al principio no hay ninguna marcada. Entrega 3.

- **Qué decides:** qué gasto variable conserva el escenario «Solo lo esencial». Las categorías hoy no tienen marca de esencial; el 50/30/20 clasifica por tipo fijo/variable, no por categoría.
- **Qué cambia:** marcarlas en la pantalla de proyección (guardado local) no toca el esquema. Añadir un campo `essential` a `categories` sí lo toca, pero serviría también al presupuesto.
- **Recomendación:** elegir las categorías esenciales en la propia pantalla, guardado en el dispositivo. Al principio no hay ninguna marcada y se invita a elegirlas.

### P7 · ¿Qué pasa con «Mi dinero total» del hero? (nueva)

**Decisión (2026-11-20):** en la entrega 1 se deja como está. Un ticket aparte, con ADR en `docs/decisions/`, lo alineará después (hero y `PatrimonioSummary` restarían `totalBalance`).

- **Qué decides:** si la cifra existente se alinea con el dinero real.
- **Qué cambia:** hoy suma el ahorro y solo resta lo **facturado** pendiente, no el ciclo abierto. Puede verse sano mientras el dinero real es negativo. Además, «Mis finanzas» no resta tarjetas en absoluto.
- **Recomendación:** en la entrega 1 dejarla como está, con rótulos claros. Después, un ticket aparte para que reste el saldo pendiente completo (`totalBalance`) en el hero y en `PatrimonioSummary`. Es un cambio de regla visible que merece su propia decisión en `docs/decisions/`.
