// Selectores puros del Dashboard. Helpers NUEVOS no cubiertos por utils:
// desglose top5+Otros, uso de presupuesto, split de patrimonio.
import { groupByCategory, getEffectiveAmount } from '../../../utils/calculations';
import { getCardBalances } from '../../../utils/creditCards';
import { tr, monthShort } from '../../../i18n/runtime';

const OTROS_COLOR = '#6b7280';
const OTROS_ICON = '📦';

// Top 5 categorías de gasto del mes + "Otros". Reusa groupByCategory (que ya
// resta cashback vía getEffectiveAmount). Devuelve [{ name, value, color, icon }].
export function getCategoryBreakdown(monthTransactions, categories) {
  const expenses = monthTransactions.filter((t) =>
    ['expense', 'fixed_expense', 'variable_expense'].includes(t.type));
  if (expenses.length === 0) return [];

  const grouped = groupByCategory(expenses, categories)
    .map((g) => ({ name: g.category.name, value: g.total, color: g.category.color, icon: g.category.icon }))
    .filter((g) => g.value > 0)
    .sort((a, b) => b.value - a.value);
  if (grouped.length === 0) return [];

  if (grouped.length <= 5) return grouped;
  const top = grouped.slice(0, 5);
  const rest = grouped.slice(5).reduce((s, g) => s + g.value, 0);
  return [...top, { name: tr('screens.charts.others'), value: rest, color: OTROS_COLOR, icon: OTROS_ICON }];
}

// Uso del presupuesto del mes a partir del summary de getBudgetSummary.
// Presupuestado = planes fijos+variables+ahorro; gastado = reales+ahorro.
// null si no hay nada presupuestado.
export function getBudgetUsage(summary) {
  const budgeted = (Number(summary.gastosFijosPlan) || 0)
    + (Number(summary.gastosVariablesPlan) || 0)
    + (Number(summary.ahorroPlan) || 0);
  if (budgeted <= 0) return null;
  const spent = (Number(summary.gastosFijosReal) || 0)
    + (Number(summary.variableGastado) || 0)
    + (Number(summary.ahorroReal) || 0);
  const rawPct = (spent / budgeted) * 100;
  return {
    spent,
    budgeted,
    // pct: para el ANCHO de la barra (topado a 100). rawPct: para el NÚMERO,
    // sin topar, para que el usuario vea cuánto se pasó de su plan (p. ej. 115%)
    // en vez de quedarse mudo en "100%".
    pct: Math.min(100, rawPct),
    rawPct,
    overBudget: spent > budgeted,
    estado: summary.estado,
  };
}

// Ritmo del presupuesto del mes EN CURSO: compara el avance del gasto contra el
// avance del calendario y proyecta el cierre a ritmo constante. Para meses
// pasados (o sin presupuesto) devuelve null y la barra se muestra sin marcador.
// Devuelve { monthPct, projected, leftover, runOutDay, verdict } con verdict:
//   'over'    — ya se superó lo presupuestado
//   'fast'    — aún no, pero la proyección lo supera (runOutDay = día estimado)
//   'ontrack' — la proyección cierra dentro del presupuesto (leftover = sobrante)
export function getBudgetPace(usage, { isCurrentMonth, dayOfMonth, daysInMonth }) {
  if (!usage || !isCurrentMonth || !daysInMonth || daysInMonth <= 0) return null;
  const day = Math.max(1, Math.min(dayOfMonth, daysInMonth));
  const monthPct = (day / daysInMonth) * 100;

  const dailyRate = usage.spent / day;
  const projected = dailyRate * daysInMonth;
  const leftover = usage.budgeted - projected;

  let verdict, runOutDay = null;
  if (usage.overBudget) {
    verdict = 'over';
  } else if (projected > usage.budgeted) {
    verdict = 'fast';
    runOutDay = Math.min(daysInMonth, Math.ceil(usage.budgeted / dailyRate));
  } else {
    verdict = 'ontrack';
  }

  return { monthPct, projected, leftover, runOutDay, verdict };
}

const EXPENSE_TYPES = ['expense', 'fixed_expense', 'variable_expense'];

// Suma todos los pagos registrados a tarjetas (card.payments). Esos pagos son el
// momento en que el efectivo REALMENTE sale del banco para saldar la tarjeta.
function sumCardPayments(cards) {
  let total = 0;
  for (const c of cards || []) {
    for (const p of c.payments || []) total += Number(p.amount) || 0;
  }
  return total;
}

// Efectivo disponible (líquido) DERIVADO de los movimientos. Modela el efectivo
// REAL en la cuenta de banco:
//   + saldo inicial declarado
//   + ingresos
//   − gastos SIN tarjeta (netos de cashback)   ← un gasto con tarjeta NO sale del
//                                                 banco hasta pagar el estado de cuenta
//   − apartados a ahorro (tipo 'savings')
//   − pagos de tarjeta registrados (card.payments) ← aquí sí sale el efectivo
// Una sola fuente de verdad: transacciones + pagos de tarjeta. No se almacena saldo.
export function getLiquidCash(transactions, initialCashBalance, cards) {
  let cash = Number(initialCashBalance) || 0;
  for (const t of transactions || []) {
    if (t.type === 'income') cash += Number(t.amount) || 0;
    else if (EXPENSE_TYPES.includes(t.type)) {
      if (t.cardId) continue; // gasto con tarjeta: el efectivo sigue en el banco
      cash -= getEffectiveAmount(t);
    } else if (t.type === 'savings') cash -= Number(t.amount) || 0;
  }
  cash -= sumCardPayments(cards);
  return cash;
}

// Cambio del efectivo en el mes: income − gastos SIN tarjeta netos − apartados a
// ahorro − pagos de tarjeta hechos ESE mes. Misma regla que getLiquidCash pero sin
// saldo inicial (es un delta, no un saldo). `cards`/`year`/`month` son opcionales:
// si se pasan, se restan los pagos de tarjeta con fecha dentro de (year, month).
export function getLiquidDelta(monthTransactions, cards, year, month) {
  let delta = 0;
  for (const t of monthTransactions || []) {
    if (t.type === 'income') delta += Number(t.amount) || 0;
    else if (EXPENSE_TYPES.includes(t.type)) {
      if (t.cardId) continue; // gasto con tarjeta: no mueve el efectivo
      delta -= getEffectiveAmount(t);
    } else if (t.type === 'savings') delta -= Number(t.amount) || 0;
  }
  if (cards && year != null && month != null) {
    for (const c of cards) {
      for (const p of c.payments || []) {
        if (!p.date) continue;
        const d = new Date(p.date + 'T00:00:00');
        if (d.getFullYear() === year && d.getMonth() === month) delta -= Number(p.amount) || 0;
      }
    }
  }
  return delta;
}

// Lista de {y, m} para los `range` meses que terminan en refDate (incluido).
function monthsRange(range, refDate) {
  const out = [];
  for (let i = range - 1; i >= 0; i--) {
    let m = refDate.getMonth() - i;
    let y = refDate.getFullYear();
    while (m < 0) { m += 12; y -= 1; }
    out.push({ y, m });
  }
  return out;
}

// Primer mes con alguna transacción: { y, m } de la fecha más antigua, o null si
// no hay datos. Sirve para limitar los selectores a "no ir antes del primer dato".
export function getFirstDataMonth(transactions) {
  let min = null;
  for (const t of transactions || []) {
    if (!t.date) continue;
    const d = new Date(t.date + 'T00:00:00');
    if (!min || d < min) min = d;
  }
  return min ? { y: min.getFullYear(), m: min.getMonth() } : null;
}

// Aporte al EFECTIVO de una transacción (la misma regla de getLiquidCash, por tx):
// income suma; gasto sin tarjeta resta (neto de cashback); gasto con tarjeta no
// mueve efectivo; savings resta (se apartó). No incluye pagos de tarjeta (esos no
// son transacciones; se manejan aparte donde aplique).
function cashEffect(t) {
  if (t.type === 'income') return Number(t.amount) || 0;
  if (EXPENSE_TYPES.includes(t.type)) return t.cardId ? 0 : -getEffectiveAmount(t);
  if (t.type === 'savings') return -(Number(t.amount) || 0);
  return 0;
}

// Patrimonio líquido (efectivo + ahorros) ACUMULADO al cierre de cada mes del
// rango — un saldo corrido que muestra el crecimiento en el tiempo. La clave:
// apartar a ahorro mueve dinero de efectivo a ahorro pero NO cambia el total, así
// que la línea solo sube cuando entra dinero nuevo (sobrante real). También
// devuelve income/expense del mes para las barras pequeñas de fondo.
// `range`: número de meses (3, 12…) o 'all'. En TODOS los casos el rango se
// recorta para NO ir antes de la primera transacción (no se muestran meses vacíos
// previos a los datos). `cards` (opcional) permite calcular las "tarjetas por
// pagar" históricas por mes (saldo facturado pendiente al cierre de cada mes).
// `currentSavings` es el ahorro REAL de hoy (Σ goal.currentAmount, incluye el saldo
// que ya tenían las metas antes de usar la app). El ahorro de cada mes se reconstruye
// hacia atrás desde ese total real, restando los aportes (savings) posteriores al
// cierre del mes — así el mes actual cuadra con la pestaña de Ahorros y el histórico
// tiene sentido. Devuelve [{ label, y, m, income, expense, cash, savings, wealth,
// savingsRate, cardsDue }] donde wealth = cash + savings − cardsDue (patrimonio
// neto líquido: descuenta la deuda de tarjetas por pagar).
export function getCumulativeLiquidWealth(transactions, initialCashBalance, range, refDate = new Date(), cards = [], currentSavings = 0) {
  const txs = transactions || [];
  // Meses disponibles desde el primer dato hasta refDate (incluidos).
  const first = getFirstDataMonth(txs);
  const available = first
    ? Math.max(1, (refDate.getFullYear() - first.y) * 12 + (refDate.getMonth() - first.m) + 1)
    : 1;
  // 'all' = todo lo disponible; un número = ese número, pero sin pasar del primer dato.
  const count = range === 'all' ? available : Math.min(Number(range) || 1, available);
  const months = monthsRange(count, refDate);

  return months.map(({ y, m }) => {
    // Fin de mes (exclusivo): primer día del mes siguiente.
    const monthEnd = new Date(y, m + 1, 1);
    // Día representativo del mes para "tarjetas por pagar" históricas (fin de mes).
    const monthRef = new Date(y, m + 1, 0);
    // Efectivo acumulado: saldo inicial + efecto de las transacciones anteriores al
    // fin de mes − pagos de tarjeta anteriores al fin de mes (ver más abajo).
    // Ahorro: parte del total REAL de hoy y resta los aportes POSTERIORES al cierre,
    // así reconstruye cuánto había al cierre de este mes (incluye el saldo previo
    // de las metas, que no viene de transacciones).
    let cash = Number(initialCashBalance) || 0;
    let savings = Number(currentSavings) || 0;
    let income = 0, expense = 0;
    for (const t of txs) {
      if (!t.date) continue;
      const d = new Date(t.date + 'T00:00:00');
      if (d < monthEnd) {
        cash += cashEffect(t);
      } else if (t.type === 'savings') {
        // Aporte posterior al cierre: réstalo para volver al ahorro de aquel mes.
        savings -= Number(t.amount) || 0;
      }
      // income/expense SOLO del mes (para las barras).
      if (d.getFullYear() === y && d.getMonth() === m) {
        if (t.type === 'income') income += Number(t.amount) || 0;
        else if (EXPENSE_TYPES.includes(t.type)) expense += getEffectiveAmount(t);
      }
    }
    // Pagos de tarjeta anteriores al cierre del mes: aquí el efectivo SÍ sale del
    // banco (mismo criterio que getLiquidCash). Sin fecha → se trata como ya
    // ocurrido (se resta), igual que el saldo total. Esto mantiene la línea del
    // gráfico consistente con el efectivo de "Mis finanzas".
    for (const c of cards || []) {
      for (const p of c.payments || []) {
        if (!p.date || new Date(p.date + 'T00:00:00') < monthEnd) cash -= Number(p.amount) || 0;
      }
    }
    // Tasa de ahorro del mes: (ingresos − gastos) / ingresos, en %.
    const savingsRate = income > 0 ? ((income - expense) / income) * 100 : 0;
    // Tarjetas por pagar al cierre del mes (saldo facturado pendiente).
    const cardsDue = (cards || []).reduce(
      (sum, c) => sum + (getCardBalances(c, txs, monthRef).pendingBilled || 0), 0,
    );
    // Dinero total = patrimonio neto LÍQUIDO: efectivo + ahorro − tarjetas por
    // pagar. Restar la deuda de tarjetas evita que "Mi dinero total" iguale al
    // "Efectivo disponible" cuando no hay ahorro, y refleja lo que de verdad
    // queda tras saldar lo facturado. No topa en 0: si debes más de lo que
    // tienes, el neto puede ser negativo (señal honesta).
    const wealth = cash + savings - cardsDue;
    return { label: monthShort(m), y, m, income, expense, cash, savings, wealth, savingsRate, cardsDue };
  });
}

// Tope de puntos diarios del timeline (~18 meses). Por encima, la serie pasa a
// granularidad MENSUAL: dibujar miles de puntos no aporta lectura y castiga el
// render; por debajo, el detalle diario da "suficientes datos" a la línea.
const MAX_DAILY_POINTS = 550;

const pad2 = (n) => String(n).padStart(2, '0');

// Serie temporal del patrimonio para el hero del Resumen (línea estilo Stitch).
// Misma regla de dinero que getCumulativeLiquidWealth, pero con granularidad
// DIARIA cuando la ventana cabe en MAX_DAILY_POINTS días (rangos 3M/1A y "todo"
// con poco historial) y MENSUAL cuando no. Cada punto lleva una `key` estable
// para fijar la selección con click: 'YYYY-MM-DD' (diaria) o 'YYYY-MM' (mensual).
// En los puntos diarios, income/expense son el flujo ACUMULADO del mes hasta ese
// día (month-to-date): al escrubear o fijar un día, el encabezado cuenta cómo
// iba el mes en ese momento. cash/savings/cardsDue/wealth son el saldo AL CIERRE
// del día, con las mismas reglas que la serie mensual (pagos de tarjeta restan
// desde su fecha; sin fecha se tratan como ya ocurridos; el ahorro se reconstruye
// hacia atrás desde el total real de hoy restando aportes posteriores al día).
export function getWealthTimeline(transactions, initialCashBalance, range, refDate = new Date(), cards = [], currentSavings = 0) {
  const txs = (transactions || []).filter((t) => t.date);
  const today = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());

  // Inicio de la ventana: primera transacción para 'all'; para N meses, el día 1
  // del primer mes del rango — y nunca antes del primer dato (sin días vacíos).
  let start = today; // sin datos: un solo punto (hoy) con el saldo inicial
  if (txs.length > 0) {
    let firstTxDate = null;
    for (const t of txs) {
      const d = new Date(t.date + 'T00:00:00');
      if (!firstTxDate || d < firstTxDate) firstTxDate = d;
    }
    if (range === 'all') {
      start = firstTxDate;
    } else {
      const rangeStart = new Date(refDate.getFullYear(), refDate.getMonth() - (Number(range) || 1) + 1, 1);
      start = firstTxDate > rangeStart ? firstTxDate : rangeStart;
    }
    if (start > today) start = today;
  }

  const dayCount = Math.round((today - start) / 86400000) + 1;
  if (dayCount > MAX_DAILY_POINTS) {
    return getCumulativeLiquidWealth(transactions, initialCashBalance, range, refDate, cards, currentSavings)
      .map((p) => ({ ...p, key: `${p.y}-${pad2(p.m + 1)}` }));
  }

  // ── Granularidad diaria: una sola pasada sobre movimientos ordenados ──
  const sorted = [...txs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let cash = Number(initialCashBalance) || 0;
  const payments = [];
  for (const c of cards || []) {
    for (const p of c.payments || []) {
      if (!p.date) cash -= Number(p.amount) || 0; // sin fecha: como ya ocurrido
      else payments.push(p);
    }
  }
  payments.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Aportes a ahorro aún "futuros" respecto del día iterado: el ahorro del día
  // es el total real de hoy menos estos aportes pendientes de descontar.
  let futureSavings = 0;
  for (const t of sorted) if (t.type === 'savings') futureSavings += Number(t.amount) || 0;

  const out = [];
  let ti = 0, pi = 0, mtdIncome = 0, mtdExpense = 0;
  const day = new Date(start);
  for (let i = 0; i < dayCount; i++) {
    if (day.getDate() === 1) { mtdIncome = 0; mtdExpense = 0; } // nuevo mes: reinicia el flujo
    const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    while (ti < sorted.length) {
      const t = sorted[ti];
      const d = new Date(t.date + 'T00:00:00');
      if (d >= dayEnd) break;
      cash += cashEffect(t);
      if (t.type === 'savings') futureSavings -= Number(t.amount) || 0;
      if (d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth()) {
        if (t.type === 'income') mtdIncome += Number(t.amount) || 0;
        else if (EXPENSE_TYPES.includes(t.type)) mtdExpense += getEffectiveAmount(t);
      }
      ti++;
    }
    while (pi < payments.length && new Date(payments[pi].date + 'T00:00:00') < dayEnd) {
      cash -= Number(payments[pi].amount) || 0;
      pi++;
    }
    const savings = (Number(currentSavings) || 0) - futureSavings;
    const cardsDue = (cards || []).reduce(
      (sum, c) => sum + (getCardBalances(c, txs, day).pendingBilled || 0), 0,
    );
    out.push({
      key: `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}`,
      y: day.getFullYear(), m: day.getMonth(), d: day.getDate(),
      label: `${day.getDate()} ${monthShort(day.getMonth())}`,
      income: mtdIncome, expense: mtdExpense, cash, savings, cardsDue,
      wealth: cash + savings - cardsDue,
      savingsRate: mtdIncome > 0 ? ((mtdIncome - mtdExpense) / mtdIncome) * 100 : 0,
    });
    day.setDate(day.getDate() + 1);
  }
  return out;
}

// Aire (fracción del rango) que se agrega al dominio vertical de la línea de
// patrimonio. SIMÉTRICO: el anillo del ping de HOY (r máx 14 + trazo ≈ 15px)
// necesita el mismo espacio arriba que abajo, porque HOY puede ser el pico
// (patrimonio subiendo) o el valle (bajando) y el SVG recorta lo que se sale.
const WEALTH_Y_PAD_TOP = 0.12;    // 12% de aire sobre el pico
const WEALTH_Y_PAD_BOTTOM = 0.12; // 12% bajo el valle

// Dominio vertical [min, max] de la línea de patrimonio con AIRE arriba y abajo
// para que NO se corte al subir mucho. Con `[dataMin, dataMax]` el pico queda
// pegado al borde del área de dibujo y recharts lo recorta: la curva 'natural'
// sobrepasa el máximo entre puntos (overshoot del spline) y el punto de HOY lleva
// un halo, así que ambos se cortarían. El margen es proporcional al RANGO real de
// los datos, de modo que se adapta a cualquier escala (patrimonios chicos o
// grandes). Serie plana → usa el valor absoluto como base para no colapsar en una
// línea sin altura. Serie vacía → dominio seguro [0, 1].
export function getWealthYDomain(data, key = 'wealth') {
  const vals = (data || []).map((p) => Number(p[key]) || 0);
  if (vals.length === 0) return [0, 1];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = (max - min) || Math.abs(max) || 1;
  return [min - span * WEALTH_Y_PAD_BOTTOM, max + span * WEALTH_Y_PAD_TOP];
}

// Punto que manda en el encabezado del hero: el que está bajo el cursor
// (scrubbing) gana; si no hay hover, el punto FIJADO con click (selectedKey);
// en reposo y sin selección, el último (hoy). Serie vacía → null.
export function pickHeadPoint(data, hoverIdx, selectedKey) {
  if (!data || data.length === 0) return null;
  if (hoverIdx != null && data[hoverIdx]) return data[hoverIdx];
  if (selectedKey != null) {
    const sel = data.find((p) => p.key === selectedKey);
    if (sel) return sel;
  }
  return data[data.length - 1];
}

// Ventana (en días) para recordar una tarjeta por pagar en el Resumen. El
// estado de cuenta suele vencer ~25 días después del corte (p. ej. corte el 1,
// pago el 26), así que 14 días dejaba fuera tarjetas recién facturadas. 30 días
// alinea la ventana con la de las metas y avisa desde que la tarjeta se factura.
const CARD_REMINDER_WINDOW_DAYS = 30;

// Recordatorios de tarjetas por pagar (puro). Una entrada por tarjeta con saldo
// facturado pendiente (pendingBilled > 0, no pagada) cuyo pago vence dentro de
// la ventana [0, windowDays] días desde refDate. Ordenable por `days` (asc = más
// urgente). Devuelve [{ cardName, amount, dueDateISO, days }]. La capa de UI le
// pone rótulos, colores e i18n; aquí solo va la regla de qué recordar y cuándo.
export function getCardReminders(cards, transactions, refDate = new Date(), windowDays = CARD_REMINDER_WINDOW_DAYS) {
  const todayMid = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
  const out = [];
  for (const card of cards || []) {
    const bal = getCardBalances(card, transactions, refDate);
    if (bal.isPaid || bal.pendingBilled <= 0) continue;
    const due = new Date(bal.cycles.dueDateISO + 'T00:00:00');
    const days = Math.round((due - todayMid) / 86400000);
    if (days < 0 || days > windowDays) continue;
    out.push({ cardName: card.name, amount: bal.pendingBilled, dueDateISO: bal.cycles.dueDateISO, days });
  }
  return out;
}

// Config del número grande del hero. La línea única del Resumen muestra SIEMPRE
// el patrimonio neto líquido (wealth); se ignoran argumentos heredados del viejo
// toggle barras/línea para no romper llamadas existentes.
export function getHeroMetric() {
  return { key: 'wealth', labelKey: 'dashboard.netWorth', infoKey: 'dashboard.myMoneyTotalInfo' };
}

// Split patrimonio: proporciones ahorro/deuda y patrimonio neto.
export function getNetWorthSplit(totalSaved, totalDebt) {
  const saved = Number(totalSaved) || 0;
  const debt = Number(totalDebt) || 0;
  const sum = saved + debt;
  return {
    saved,
    debt,
    savedPct: sum > 0 ? (saved / sum) * 100 : 0,
    debtPct: sum > 0 ? (debt / sum) * 100 : 0,
    netWorth: saved - debt,
    hasData: sum > 0,
  };
}

// Cuánto falta de efectivo para cubrir un pago. `shortfall` es lo que habría que
// tomar de ahorros; `available` es el efectivo disponible hoy.
export function getCashShortfall(transactions, initialCashBalance, cards, paymentAmount) {
  const available = getLiquidCash(transactions, initialCashBalance, cards);
  const amt = Number(paymentAmount) || 0;
  return { available, shortfall: Math.max(0, amt - available) };
}

// ¿Se puede pagar? (efectivo + ahorros ≥ pago). totalSavings = Σ goal.currentAmount.
export function canAffordPayment(available, totalSavings, paymentAmount) {
  return (Number(available) || 0) + (Number(totalSavings) || 0) >= (Number(paymentAmount) || 0);
}
