import { describe, it, expect } from 'vitest';
import { getCategoryBreakdown, getBudgetUsage, getBudgetPace, getNetWorthSplit, getLiquidCash, getLiquidDelta, getFirstDataMonth, getCumulativeLiquidWealth, getWealthTimeline, pickHeadPoint, getCashShortfall, canAffordPayment, getCardReminders, getHeroMetric, getWealthYDomain, getRealMoney, computeShortfall, hasLegacyPaidCycles, getNetWorth } from './selectors';
import { getCardBalances } from '../../../utils/creditCards';

const cats = [
  { id: 'c1', name: 'Supermercado', color: '#aaa' },
  { id: 'c2', name: 'Transporte', color: '#bbb' },
  { id: 'c3', name: 'Restaurantes', color: '#ccc' },
  { id: 'c4', name: 'Suscripciones', color: '#ddd' },
  { id: 'c5', name: 'Salud', color: '#eee' },
  { id: 'c6', name: 'Ropa', color: '#fff' },
  { id: 'c7', name: 'Otros gastos', color: '#111' },
];
const tx = (categoryId, amount, type = 'variable_expense', cashbackEarned = 0) => ({ categoryId, amount, type, cashbackEarned });

describe('getCategoryBreakdown', () => {
  it('sin gastos → arreglo vacío', () => {
    expect(getCategoryBreakdown([], cats)).toEqual([]);
  });

  it('ignora ingresos y ahorros; resta cashback', () => {
    const txs = [tx('c1', 1000, 'income'), tx('c1', 500, 'savings'), tx('c1', 200, 'variable_expense', 20)];
    const r = getCategoryBreakdown(txs, cats);
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('Supermercado');
    expect(r[0].value).toBe(180); // 200 - 20 cashback
  });

  it('con ≤5 categorías no agrega "Otros"', () => {
    const txs = [tx('c1', 500), tx('c2', 400), tx('c3', 300)];
    const r = getCategoryBreakdown(txs, cats);
    expect(r.map((x) => x.name)).toEqual(['Supermercado', 'Transporte', 'Restaurantes']);
    expect(r.some((x) => x.name === 'Otros')).toBe(false);
  });

  it('con >5 categorías deja top 5 y agrega "Otros" con el resto', () => {
    const txs = [tx('c1', 600), tx('c2', 500), tx('c3', 400), tx('c4', 300), tx('c5', 200), tx('c6', 100), tx('c7', 50)];
    const r = getCategoryBreakdown(txs, cats);
    expect(r).toHaveLength(6); // top 5 + Otros
    expect(r[5].name).toBe('Otros');
    expect(r[5].value).toBe(150); // 100 + 50
  });

  it('ordena de mayor a menor', () => {
    const txs = [tx('c2', 100), tx('c1', 900)];
    const r = getCategoryBreakdown(txs, cats);
    expect(r[0].name).toBe('Supermercado');
    expect(r[0].value).toBe(900);
  });
});

describe('getBudgetUsage', () => {
  it('sin ingreso ni plan → null', () => {
    expect(getBudgetUsage({ estado: 'neutral', gastosFijosPlan: 0, gastosVariablesPlan: 0, ahorroPlan: 0, gastosFijosReal: 0, variableGastado: 0, ahorroReal: 0 })).toBeNull();
  });

  it('calcula gastado, presupuestado, pct y estado', () => {
    const r = getBudgetUsage({ estado: 'good', gastosFijosPlan: 20000, gastosVariablesPlan: 10000, ahorroPlan: 5000, gastosFijosReal: 18000, variableGastado: 7000, ahorroReal: 5000 });
    expect(r.budgeted).toBe(35000); // 20000+10000+5000
    expect(r.spent).toBe(30000);    // 18000+7000+5000
    expect(r.pct).toBeCloseTo((30000 / 35000) * 100);
    expect(r.estado).toBe('good');
    expect(r.overBudget).toBe(false);
  });

  it('marca sobregiro cuando gastado supera presupuestado', () => {
    const r = getBudgetUsage({ estado: 'danger', gastosFijosPlan: 10000, gastosVariablesPlan: 0, ahorroPlan: 0, gastosFijosReal: 12000, variableGastado: 0, ahorroReal: 0 });
    expect(r.overBudget).toBe(true);
    expect(r.pct).toBe(100); // tope visual
  });
});

describe('getBudgetPace', () => {
  const usage = (spent, budgeted, overBudget = spent > budgeted) => ({ spent, budgeted, overBudget, pct: Math.min(100, (spent / budgeted) * 100), estado: 'good' });

  it('mes pasado o sin presupuesto → null', () => {
    expect(getBudgetPace(usage(100, 1000), { isCurrentMonth: false, dayOfMonth: 10, daysInMonth: 30 })).toBeNull();
    expect(getBudgetPace(null, { isCurrentMonth: true, dayOfMonth: 10, daysInMonth: 30 })).toBeNull();
  });

  it('gasto por debajo del ritmo → ontrack con sobrante proyectado', () => {
    // Día 15 de 30 (50% del mes), gastado 40% del presupuesto.
    const r = getBudgetPace(usage(4000, 10000), { isCurrentMonth: true, dayOfMonth: 15, daysInMonth: 30 });
    expect(r.verdict).toBe('ontrack');
    expect(r.monthPct).toBeCloseTo(50);
    expect(r.projected).toBeCloseTo(8000); // 4000/15*30
    expect(r.leftover).toBeCloseTo(2000);
    expect(r.runOutDay).toBeNull();
  });

  it('gasto acelerado → fast con día estimado de agotamiento', () => {
    // Día 10 de 30, gastado 50%: proyección 15000 sobre 10000.
    const r = getBudgetPace(usage(5000, 10000), { isCurrentMonth: true, dayOfMonth: 10, daysInMonth: 30 });
    expect(r.verdict).toBe('fast');
    expect(r.projected).toBeCloseTo(15000);
    expect(r.runOutDay).toBe(20); // 10000 / (5000/10)
  });

  it('ya sobregirado → over', () => {
    const r = getBudgetPace(usage(12000, 10000), { isCurrentMonth: true, dayOfMonth: 20, daysInMonth: 30 });
    expect(r.verdict).toBe('over');
  });

  it('día 1 no divide por cero y clampa al rango del mes', () => {
    const r = getBudgetPace(usage(500, 10000), { isCurrentMonth: true, dayOfMonth: 0, daysInMonth: 30 });
    expect(r.verdict).toBe('fast'); // 500/1*30 = 15000 > 10000
    expect(r.runOutDay).toBe(20);
  });
});

describe('getLiquidCash', () => {
  it('sin transacciones → solo el saldo inicial', () => {
    expect(getLiquidCash([], 50000, [])).toBe(50000);
  });

  it('los ingresos suben el efectivo', () => {
    const txs = [tx('c1', 1000, 'income')];
    expect(getLiquidCash(txs, 0, [])).toBe(1000);
  });

  it('los gastos SIN tarjeta bajan el efectivo, netos de cashback', () => {
    // gasto 200 con 20 de cashback, sin tarjeta → resta 180
    const txs = [tx('c1', 200, 'variable_expense', 20)];
    expect(getLiquidCash(txs, 1000, [])).toBe(820);
  });

  it('los gastos CON tarjeta NO bajan el efectivo (sigue en el banco)', () => {
    // gasto con cardId: el efectivo no se mueve hasta pagar la tarjeta
    const txs = [{ categoryId: 'c1', amount: 500, type: 'variable_expense', cashbackEarned: 0, cardId: 'cc1' }];
    expect(getLiquidCash(txs, 1000, [])).toBe(1000);
  });

  it('los pagos de tarjeta SÍ bajan el efectivo', () => {
    const cards = [{ id: 'cc1', payments: [{ id: 'p1', amount: 300 }, { id: 'p2', amount: 200 }] }];
    expect(getLiquidCash([], 1000, cards)).toBe(500);
  });

  it('los apartados a ahorro (savings) bajan el efectivo', () => {
    const txs = [tx('c1', 500, 'savings')];
    expect(getLiquidCash(txs, 1000, [])).toBe(500);
  });

  it('combina saldo, ingresos, gastos sin/con tarjeta, ahorros y pagos de tarjeta', () => {
    const txs = [
      tx('c1', 2000, 'income'),
      tx('c2', 300, 'variable_expense', 0),                                              // sin tarjeta: resta 300
      { categoryId: 'c3', amount: 800, type: 'variable_expense', cashbackEarned: 0, cardId: 'cc1' }, // con tarjeta: no resta
      tx('c4', 500, 'savings'),                                                          // resta 500
    ];
    const cards = [{ id: 'cc1', payments: [{ id: 'p1', amount: 600 }] }];               // pago tarjeta: resta 600
    // 1000 + 2000 - 300 - 500 - 600 = 1600
    expect(getLiquidCash(txs, 1000, cards)).toBe(1600);
  });

  it('saldo inicial inválido o ausente → tratado como 0; cards opcional', () => {
    expect(getLiquidCash([tx('c1', 100, 'income')], undefined, undefined)).toBe(100);
  });
});

describe('getLiquidDelta', () => {
  it('sin transacciones → 0', () => {
    expect(getLiquidDelta([])).toBe(0);
  });

  it('income − gastos sin tarjeta netos − savings del mes', () => {
    const txs = [
      tx('c1', 5000, 'income'),
      tx('c2', 1200, 'variable_expense', 200), // sin tarjeta, neto 1000
      tx('c3', 500, 'savings'),
    ];
    // 5000 - 1000 - 500 = 3500
    expect(getLiquidDelta(txs)).toBe(3500);
  });

  it('los gastos con tarjeta NO afectan el delta', () => {
    const txs = [
      tx('c1', 5000, 'income'),
      { categoryId: 'c2', amount: 2000, type: 'variable_expense', cashbackEarned: 0, cardId: 'cc1' },
    ];
    expect(getLiquidDelta(txs)).toBe(5000);
  });

  it('los pagos de tarjeta del mes restan del delta', () => {
    const txs = [tx('c1', 5000, 'income')];
    // pago de tarjeta en el mes del cálculo (year/month)
    const cards = [{ id: 'cc1', payments: [{ id: 'p1', amount: 1200, date: '2026-06-10' }] }];
    expect(getLiquidDelta(txs, cards, 2026, 5)).toBe(3800); // 5000 - 1200
  });

  it('mes negativo cuando se gasta más de lo que entra', () => {
    const txs = [tx('c1', 1000, 'income'), tx('c2', 1500, 'fixed_expense', 0)];
    expect(getLiquidDelta(txs)).toBe(-500);
  });
});

describe('getNetWorthSplit', () => {
  it('sin datos → hasData false', () => {
    const r = getNetWorthSplit(0, 0);
    expect(r.hasData).toBe(false);
  });

  it('solo ahorro → 100% ahorro', () => {
    const r = getNetWorthSplit(50000, 0);
    expect(r.savedPct).toBe(100);
    expect(r.debtPct).toBe(0);
    expect(r.netWorth).toBe(50000);
    expect(r.hasData).toBe(true);
  });

  it('ahorro + deuda → proporciones y patrimonio neto', () => {
    const r = getNetWorthSplit(60000, 40000);
    expect(r.savedPct).toBeCloseTo(60);
    expect(r.debtPct).toBeCloseTo(40);
    expect(r.netWorth).toBe(20000);
  });
});

describe('getFirstDataMonth', () => {
  const dtx = (date, type = 'income') => ({ categoryId: 'c1', amount: 100, type, cashbackEarned: 0, date });

  it('sin transacciones → null', () => {
    expect(getFirstDataMonth([])).toBeNull();
  });

  it('devuelve el {y, m} de la transacción más antigua', () => {
    const txs = [dtx('2026-03-10'), dtx('2026-01-05'), dtx('2026-06-20')];
    expect(getFirstDataMonth(txs)).toEqual({ y: 2026, m: 0 }); // enero = 0
  });

  it('cruza el cambio de año', () => {
    const txs = [dtx('2026-02-01'), dtx('2025-11-15')];
    expect(getFirstDataMonth(txs)).toEqual({ y: 2025, m: 10 }); // noviembre = 10
  });
});

describe('getCumulativeLiquidWealth', () => {
  const ref = new Date('2026-03-15T00:00:00');
  const t = (amount, type, date, extra = {}) => ({ categoryId: 'c1', amount, type, cashbackEarned: 0, date, ...extra });

  it('acumula efectivo + ahorros al cierre de cada mes (saldo corrido)', () => {
    const txs = [
      t(1000, 'income', '2026-01-10'),          // ene: +1000 efectivo
      t(300, 'variable_expense', '2026-02-05'), // feb: -300 efectivo (sin tarjeta)
      t(200, 'savings', '2026-03-08'),          // mar: -200 efectivo, +200 ahorro
    ];
    // saldo inicial 500, 3 meses, currentSavings hoy = 200 (el unico aporte).
    const r = getCumulativeLiquidWealth(txs, 500, 3, ref, [], 200);
    expect(r).toHaveLength(3);
    // ene: efectivo 500+1000=1500, ahorro 200-200(aporte mar posterior)=0 → wealth 1500
    expect(r[0].wealth).toBe(1500);
    // feb: efectivo 1500-300=1200, ahorro 0 → wealth 1200
    expect(r[1].wealth).toBe(1200);
    // mar: efectivo 1200-200=1000, ahorro 200 → wealth 1200 (apartar no cambia el total)
    expect(r[2].wealth).toBe(1200);
  });

  it('desglosa wealth en cash (efectivo) y savings (ahorro) por mes', () => {
    const txs = [
      t(1000, 'income', '2026-01-10'),  // ene: efectivo +1000
      t(200, 'savings', '2026-03-08'),  // mar: efectivo -200, ahorro +200
    ];
    // currentSavings (hoy) = 200 (solo el aporte registrado, sin saldo previo).
    const r = getCumulativeLiquidWealth(txs, 500, 3, ref, [], 200);
    // mar: cash = 500+1000-200 = 1300, savings = 200, wealth = 1500
    expect(r[2].cash).toBe(1300);
    expect(r[2].savings).toBe(200);
    expect(r[2].wealth).toBe(r[2].cash + r[2].savings);
  });

  it('el ahorro parte del total REAL de hoy (incluye saldo previo de las metas)', () => {
    // currentSavings hoy = 605000 (metas con saldo previo). Solo 1 aporte de 5000
    // registrado en marzo. El mes actual debe mostrar 605000, no 5000.
    const txs = [t(5000, 'savings', '2026-03-10')];
    const r = getCumulativeLiquidWealth(txs, 0, 3, ref, [], 605000);
    const mar = r[r.length - 1]; // mes actual (marzo, = ref)
    expect(mar.savings).toBe(605000);
  });

  it('reconstruye el ahorro historico restando aportes posteriores', () => {
    // Hoy hay 600000 ahorrado. En marzo se aporto 100000. Antes de marzo (feb y
    // ene) el ahorro era 600000 - 100000 = 500000. La tx de enero asegura un rango
    // de 3 meses (el clamp no acorta por falta de datos previos).
    const txs = [t(1, 'income', '2026-01-02'), t(100000, 'savings', '2026-03-15')];
    const r = getCumulativeLiquidWealth(txs, 0, 3, ref, [], 600000);
    expect(r).toHaveLength(3);
    expect(r[0].savings).toBe(500000); // enero: antes del aporte de marzo
    expect(r[1].savings).toBe(500000); // febrero: idem
    expect(r[2].savings).toBe(600000); // marzo: ya incluye el aporte
  });

  it('los gastos con tarjeta no bajan el efectivo de la línea', () => {
    const txs = [
      t(1000, 'income', '2026-03-01'),
      t(400, 'variable_expense', '2026-03-05', { cardId: 'cc1' }), // con tarjeta: no resta
    ];
    const r = getCumulativeLiquidWealth(txs, 0, 1, ref);
    expect(r[r.length - 1].wealth).toBe(1000);
  });

  it('los pagos de tarjeta SÍ bajan el efectivo de la línea, según su fecha', () => {
    // El pago de tarjeta es cuando el efectivo sale del banco: debe restar del
    // efectivo acumulado en los meses ≥ a su fecha, no antes. Misma regla que
    // getLiquidCash (consistencia entre el gráfico y "Mis finanzas").
    const txs = [t(1000, 'income', '2026-01-10')]; // ene: +1000 efectivo
    const cards = [{ id: 'cc1', cutoffDay: 25, dueDay: 5, payments: [
      { id: 'p1', amount: 400, date: '2026-02-15' }, // pago en febrero
    ] }];
    const r = getCumulativeLiquidWealth(txs, 0, 3, ref, cards, 0);
    expect(r[0].cash).toBe(1000); // ene: antes del pago → sin restar
    expect(r[1].cash).toBe(600);  // feb: ya restó el pago de 400
    expect(r[2].cash).toBe(600);  // mar: sigue restado
  });

  it('calcula savingsRate por mes: (income − gasto) / income', () => {
    const txs = [t(5000, 'income', '2026-03-02'), t(1000, 'variable_expense', '2026-03-09')];
    const r = getCumulativeLiquidWealth(txs, 0, 1, ref);
    const mar = r[r.length - 1];
    // (5000 - 1000) / 5000 = 0.8 → 80%
    expect(mar.savingsRate).toBeCloseTo(80);
  });

  it('savingsRate es 0 cuando no hay ingresos del mes', () => {
    const txs = [t(500, 'variable_expense', '2026-03-09')];
    const r = getCumulativeLiquidWealth(txs, 0, 1, ref);
    expect(r[r.length - 1].savingsRate).toBe(0);
  });

  it('cardsDue: 0 si no se pasan tarjetas; usa getCardBalances si se pasan', () => {
    const txs = [t(5000, 'income', '2026-03-02')];
    const sinCards = getCumulativeLiquidWealth(txs, 0, 1, ref);
    expect(sinCards[0].cardsDue).toBe(0);
  });

  it('el dinero total (wealth) DESCUENTA las tarjetas por pagar', () => {
    // Regresión: "Mi dinero total" mostraba lo mismo que "Efectivo disponible"
    // cuando el ahorro era 0, porque no restaba la deuda de tarjetas. El dinero
    // total es patrimonio neto líquido = efectivo + ahorro − tarjetas por pagar.
    // openingBalance = deuda previa → pendingBilled fijo, sin mover el efectivo.
    const txs = [t(10000, 'income', '2026-03-02')];
    const cards = [{ id: 'cc1', cutoffDay: 25, dueDay: 5, openingBalance: 5000, payments: [] }];
    const r = getCumulativeLiquidWealth(txs, 0, 1, ref, cards, 0);
    const mar = r[r.length - 1];
    expect(mar.cash).toBe(10000);     // el saldo de apertura no toca el efectivo
    expect(mar.savings).toBe(0);
    expect(mar.cardsDue).toBe(5000);
    // wealth ≠ cash: descuenta lo que se debe en tarjetas (10000 + 0 − 5000).
    expect(mar.wealth).toBe(5000);
    expect(mar.wealth).not.toBe(mar.cash);
  });

  it('incluye income y expense del mes en cada punto (para las barras)', () => {
    const txs = [t(5000, 'income', '2026-03-02'), t(1200, 'variable_expense', '2026-03-09')];
    const r = getCumulativeLiquidWealth(txs, 0, 1, ref);
    const mar = r[r.length - 1];
    expect(mar.income).toBe(5000);
    expect(mar.expense).toBe(1200);
  });
});

describe('getCardReminders', () => {
  const ref = new Date('2026-07-10T00:00:00');
  // Tarjeta con corte el 1 y pago el 26: su estado cierra el 1 jul y vence el
  // 26 jul → 16 días desde hoy (10 jul). openingBalance = saldo por pagar.
  const santaCruz = { id: 'sc', name: 'Visa Bravo', cutoffDay: 1, dueDay: 26, openingBalance: 9527.85, payments: [], paidCycles: [] };

  it('recuerda una tarjeta cuyo pago vence en 16 días (más allá de 14)', () => {
    // Regresión: la ventana de 14 días dejaba fuera tarjetas que vencen entre 15
    // y 30 días (p. ej. Santa Cruz, corte el 1 / pago el 26), así que NO salían
    // en Recordatorios. Con la ventana corregida (30) sí aparece.
    const r = getCardReminders([santaCruz], [], ref);
    expect(r).toHaveLength(1);
    expect(r[0].cardName).toBe('Visa Bravo');
    expect(r[0].days).toBe(16);
    expect(r[0].amount).toBeCloseTo(9527.85);
    expect(r[0].dueDateISO).toBe('2026-07-26');
  });

  it('omite tarjetas ya pagadas (sin saldo facturado pendiente)', () => {
    const paid = { id: 'p', name: 'Qik', cutoffDay: 1, dueDay: 26, openingBalance: 0, payments: [], paidCycles: [] };
    expect(getCardReminders([paid], [], ref)).toHaveLength(0);
  });

  it('omite tarjetas cuyo pago ya venció (days < 0)', () => {
    // Corte el 1, pago el 5 → venció el 5 jul (hace 5 días).
    const overdue = { id: 'o', name: 'Vencida', cutoffDay: 1, dueDay: 5, openingBalance: 1000, payments: [], paidCycles: [] };
    expect(getCardReminders([overdue], [], ref)).toHaveLength(0);
  });

  it('respeta la ventana explícita: 16 días queda fuera con windowDays = 14', () => {
    expect(getCardReminders([santaCruz], [], ref, 14)).toHaveLength(0);
  });
});

describe('getHeroMetric', () => {
  it('el hero es siempre el patrimonio neto (wealth): la línea única lo muestra', () => {
    expect(getHeroMetric()).toEqual({ key: 'wealth', labelKey: 'dashboard.myMoneyTotal', infoKey: 'dashboard.myMoneyTotalInfo' });
  });

  it('ignora argumentos heredados del toggle barras/línea (contrato estable)', () => {
    expect(getHeroMetric('line').key).toBe('wealth');
    expect(getHeroMetric('bars').key).toBe('wealth');
  });
});

describe('getWealthTimeline', () => {
  const ref = new Date('2026-03-15T00:00:00');
  const t = (amount, type, date, extra = {}) => ({ categoryId: 'c1', amount, type, cashbackEarned: 0, date, ...extra });

  it('rango 3 meses → un punto por DÍA desde la primera transacción hasta hoy', () => {
    const txs = [t(1000, 'income', '2026-01-10')];
    const r = getWealthTimeline(txs, 500, 3, ref, [], 0);
    // 22 días de enero (10–31) + 28 de febrero + 15 de marzo = 65 puntos diarios.
    expect(r).toHaveLength(65);
    expect(r[0].key).toBe('2026-01-10');
    expect(r[r.length - 1].key).toBe('2026-03-15');
    expect(r.every((p) => p.d != null)).toBe(true);
  });

  it('la ventana no retrocede antes del inicio del rango (día 1 del primer mes)', () => {
    const txs = [t(1000, 'income', '2025-06-01')];
    const r = getWealthTimeline(txs, 0, 3, ref, [], 0);
    // ene (31) + feb (28) + mar (15) = 74 puntos; arranca el 1 de enero.
    expect(r).toHaveLength(74);
    expect(r[0].key).toBe('2026-01-01');
  });

  it('sin transacciones → un solo punto (hoy) con el saldo inicial', () => {
    const r = getWealthTimeline([], 500, 3, ref, [], 0);
    expect(r).toHaveLength(1);
    expect(r[0].key).toBe('2026-03-15');
    expect(r[0].cash).toBe(500);
    expect(r[0].wealth).toBe(500);
  });

  it('el efectivo acumula por día: cada movimiento afecta desde su fecha', () => {
    const txs = [t(1000, 'income', '2026-01-10'), t(300, 'variable_expense', '2026-02-05')];
    const r = getWealthTimeline(txs, 500, 3, ref, [], 0);
    const by = Object.fromEntries(r.map((p) => [p.key, p]));
    expect(by['2026-01-10'].cash).toBe(1500);
    expect(by['2026-02-04'].cash).toBe(1500);
    expect(by['2026-02-05'].cash).toBe(1200);
  });

  it('apartar a ahorro mueve efectivo→ahorro ese día sin cambiar el patrimonio', () => {
    const txs = [t(1000, 'income', '2026-01-10'), t(200, 'savings', '2026-03-08')];
    const r = getWealthTimeline(txs, 500, 3, ref, [], 200);
    const by = Object.fromEntries(r.map((p) => [p.key, p]));
    expect(by['2026-03-07'].cash).toBe(1500);
    expect(by['2026-03-07'].savings).toBe(0);
    expect(by['2026-03-07'].wealth).toBe(1500);
    expect(by['2026-03-08'].cash).toBe(1300);
    expect(by['2026-03-08'].savings).toBe(200);
    expect(by['2026-03-08'].wealth).toBe(1500);
  });

  it('los pagos de tarjeta restan del efectivo desde su fecha; sin fecha → siempre', () => {
    const txs = [t(1000, 'income', '2026-01-10')];
    const conFecha = [{ id: 'cc1', payments: [{ id: 'p1', amount: 400, date: '2026-02-15' }] }];
    const r = getWealthTimeline(txs, 0, 3, ref, conFecha, 0);
    const by = Object.fromEntries(r.map((p) => [p.key, p]));
    expect(by['2026-02-14'].cash).toBe(1000);
    expect(by['2026-02-15'].cash).toBe(600);
    const sinFecha = [{ id: 'cc1', payments: [{ id: 'p1', amount: 400 }] }];
    const r2 = getWealthTimeline(txs, 0, 3, ref, sinFecha, 0);
    expect(r2[0].cash).toBe(600); // primer punto (10 ene): ya descontado
  });

  it('flujo del mes acumulado hasta cada día (month-to-date) y reinicia por mes', () => {
    const txs = [t(1, 'income', '2026-01-02'), t(5000, 'income', '2026-03-02'), t(1200, 'variable_expense', '2026-03-09')];
    const r = getWealthTimeline(txs, 0, 3, ref, [], 0);
    const by = Object.fromEntries(r.map((p) => [p.key, p]));
    expect(by['2026-02-20'].income).toBe(0);   // febrero no hereda enero
    expect(by['2026-03-01'].income).toBe(0);
    expect(by['2026-03-02'].income).toBe(5000);
    expect(by['2026-03-08'].expense).toBe(0);
    expect(by['2026-03-09'].expense).toBe(1200);
    expect(by['2026-03-15'].expense).toBe(1200);
  });

  it('wealth descuenta las tarjetas por pagar de cada día', () => {
    const txs = [t(10000, 'income', '2026-03-02')];
    const cards = [{ id: 'cc1', cutoffDay: 25, dueDay: 5, openingBalance: 5000, payments: [] }];
    const r = getWealthTimeline(txs, 0, 3, ref, cards, 0);
    const last = r[r.length - 1];
    expect(last.cash).toBe(10000);
    expect(last.cardsDue).toBe(5000);
    expect(last.wealth).toBe(5000);
  });

  it('historial largo con "all" → puntos MENSUALES (clave YYYY-MM), mismos valores que la serie mensual', () => {
    const txs = [t(1000, 'income', '2024-01-05')];
    const r = getWealthTimeline(txs, 500, 'all', ref, [], 0);
    expect(r).toHaveLength(27); // ene 2024 … mar 2026
    expect(r[0].key).toBe('2024-01');
    expect(r[r.length - 1].key).toBe('2026-03');
    expect(r.every((p) => p.d == null)).toBe(true);
    const mensual = getCumulativeLiquidWealth(txs, 500, 'all', ref, [], 0);
    expect(r.map((p) => p.wealth)).toEqual(mensual.map((p) => p.wealth));
  });

  it('rango 12 meses → sigue siendo diario (≤ tope de puntos)', () => {
    const txs = [t(1000, 'income', '2025-06-20')];
    const r = getWealthTimeline(txs, 12, 12, ref, [], 0);
    expect(r).toHaveLength(269); // 20 jun 2025 … 15 mar 2026
    expect(r.every((p) => p.d != null)).toBe(true);
  });

  it('los puntos diarios llevan y/m/d y label legible ("15 mar")', () => {
    const txs = [t(1000, 'income', '2026-03-01')];
    const r = getWealthTimeline(txs, 0, 3, ref, [], 0);
    const last = r[r.length - 1];
    expect(last.y).toBe(2026);
    expect(last.m).toBe(2);
    expect(last.d).toBe(15);
    expect(last.label).toMatch(/^15 /);
  });
});

describe('getWealthYDomain', () => {
  it('serie vacía → dominio seguro [0, 1]', () => {
    expect(getWealthYDomain([])).toEqual([0, 1]);
  });

  it('agrega aire arriba (12%) y abajo (12%) proporcional al rango', () => {
    const data = [{ wealth: 100 }, { wealth: 300 }];
    // rango 200 → +24 sobre el pico (324), −24 bajo el valle (76). Simétrico:
    // el anillo del ping de HOY necesita ~15px tanto si HOY es pico como valle.
    expect(getWealthYDomain(data)).toEqual([76, 324]);
  });

  it('el pico y el valle quedan DENTRO del dominio (no tocan el borde → no se cortan)', () => {
    const data = [{ wealth: 50 }, { wealth: 1347461 }, { wealth: 900000 }];
    const [lo, hi] = getWealthYDomain(data);
    expect(hi).toBeGreaterThan(1347461); // el pico no toca el techo
    expect(lo).toBeLessThan(50);         // el valle no toca el piso
  });

  it('serie plana → conserva altura (min < max) usando el valor como base', () => {
    const data = [{ wealth: 500000 }, { wealth: 500000 }];
    const [lo, hi] = getWealthYDomain(data);
    expect(hi).toBeGreaterThan(500000);
    expect(lo).toBeLessThan(500000);
  });

  it('ignora valores no numéricos (los trata como 0)', () => {
    const data = [{ wealth: null }, { wealth: 200 }, { wealth: undefined }];
    // vals → [0, 200, 0]; rango 200 → [−24, 224]
    expect(getWealthYDomain(data)).toEqual([-24, 224]);
  });
});

describe('pickHeadPoint', () => {
  const data = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];

  it('el hover (scrubbing) gana sobre la selección', () => {
    expect(pickHeadPoint(data, 1, 'c')).toBe(data[1]);
  });

  it('sin hover, devuelve el punto seleccionado (fijado con click)', () => {
    expect(pickHeadPoint(data, null, 'b')).toBe(data[1]);
  });

  it('sin hover ni selección → el último punto (hoy)', () => {
    expect(pickHeadPoint(data, null, null)).toBe(data[2]);
  });

  it('selección que ya no existe en la serie → cae al último punto', () => {
    expect(pickHeadPoint(data, null, 'zz')).toBe(data[2]);
  });

  it('serie vacía → null', () => {
    expect(pickHeadPoint([], null, null)).toBeNull();
  });
});

describe('getCashShortfall', () => {
  it('pago cubierto por el efectivo → shortfall 0', () => {
    const r = getCashShortfall([], 5000, [], 3000);
    expect(r.available).toBe(5000);
    expect(r.shortfall).toBe(0);
  });

  it('pago mayor que el efectivo → shortfall = diferencia', () => {
    const r = getCashShortfall([], 5000, [], 8000);
    expect(r.available).toBe(5000);
    expect(r.shortfall).toBe(3000);
  });

  it('considera los movimientos en el efectivo disponible', () => {
    const txs = [{ categoryId: 'c1', amount: 1000, type: 'income', cashbackEarned: 0 }];
    const r = getCashShortfall(txs, 5000, [], 7000);
    expect(r.available).toBe(6000);
    expect(r.shortfall).toBe(1000);
  });
});

describe('computeShortfall', () => {
  it('monto 0 → sin faltante', () => {
    expect(computeShortfall(5000, 0)).toEqual({ available: 5000, shortfall: 0 });
  });

  it('monto menor que lo disponible → sin faltante', () => {
    expect(computeShortfall(5000, 3000)).toEqual({ available: 5000, shortfall: 0 });
  });

  it('monto mayor que lo disponible → faltante = diferencia', () => {
    expect(computeShortfall(5000, 8000)).toEqual({ available: 5000, shortfall: 3000 });
  });

  it('disponible negativo → el faltante incluye el hueco', () => {
    expect(computeShortfall(-2000, 3000)).toEqual({ available: -2000, shortfall: 5000 });
  });

  it('entradas no numéricas se tratan como 0 en el monto y se conserva el disponible dado', () => {
    expect(computeShortfall(5000, undefined)).toEqual({ available: 5000, shortfall: 0 });
    expect(computeShortfall(5000, 'abc')).toEqual({ available: 5000, shortfall: 0 });
    expect(computeShortfall(undefined, 3000)).toEqual({ available: 0, shortfall: 3000 });
    expect(computeShortfall(NaN, 3000)).toEqual({ available: 0, shortfall: 3000 });
  });
});

describe('canAffordPayment', () => {
  it('alcanza cuando efectivo + ahorros ≥ pago', () => {
    expect(canAffordPayment(5000, 10000, 12000)).toBe(true);
  });

  it('no alcanza cuando efectivo + ahorros < pago', () => {
    expect(canAffordPayment(5000, 4000, 12000)).toBe(false);
  });

  it('límite exacto cuenta como alcanza', () => {
    expect(canAffordPayment(5000, 5000, 10000)).toBe(true);
  });
});

describe('getRealMoney', () => {
  // Corte 20 / pago 5: a 28-may el ciclo abierto va del 21-may al 20-jun.
  const ref = new Date(2026, 4, 28);
  const card = (id, extra = {}) => ({ id, name: `Tarjeta ${id}`, cutoffDay: 20, dueDay: 5, payments: [], ...extra });
  const cardTx = (cardId, amount, date, cashbackEarned = 0) =>
    ({ categoryId: 'c1', amount, type: 'variable_expense', cashbackEarned, cardId, date });

  it('sano: efectivo 100,000 y tarjeta 40,000 → dinero real 60,000', () => {
    const r = getRealMoney([cardTx('a', 40000, '2026-05-10')], 100000, [card('a')], ref);
    expect(r.cash).toBe(100000);
    expect(r.cardsOwed).toBe(40000);
    expect(r.realMoney).toBe(60000);
    expect(r.isCritical).toBe(false);
    expect(r.shortfall).toBe(0);
  });

  it('el consumo del ciclo abierto resta, aunque no esté facturado', () => {
    const txs = [cardTx('a', 30000, '2026-05-25')];
    expect(getCardBalances(card('a'), txs, ref).pendingBilled).toBe(0); // lo que resta hoy el hero
    expect(getRealMoney(txs, 100000, [card('a')], ref).realMoney).toBe(70000);
  });

  it('pago parcial: baja el saldo de la tarjeta y el efectivo', () => {
    const cards = [card('a', { payments: [{ id: 'p1', amount: 10000, date: '2026-05-20' }] })];
    const r = getRealMoney([cardTx('a', 30000, '2026-05-10')], 100000, cards, ref);
    expect(r.cash).toBe(90000);
    expect(r.cardsOwed).toBe(20000);
    expect(r.realMoney).toBe(70000);
  });

  it('sobrepago: el saldo de la tarjeta es 0 (el saldo a favor no suma)', () => {
    const cards = [card('a', { payments: [{ id: 'p1', amount: 8000, date: '2026-05-20' }] })];
    const r = getRealMoney([cardTx('a', 5000, '2026-05-10')], 100000, cards, ref);
    expect(r.cardsOwed).toBe(0);
    expect(r.cards[0].owed).toBe(0);
    expect(r.realMoney).toBe(92000); // solo el efectivo que salió; nada vuelve
  });

  it('varias tarjetas: suma cada saldo y devuelve una entrada por tarjeta con su nombre', () => {
    const txs = [cardTx('a', 12000, '2026-05-10'), cardTx('b', 7000, '2026-05-26')];
    const r = getRealMoney(txs, 50000, [card('a'), card('b')], ref);
    expect(r.cardsOwed).toBe(19000);
    expect(r.realMoney).toBe(31000);
    expect(r.cards).toEqual([
      { id: 'a', name: 'Tarjeta a', owed: 12000, hasValidCycle: true },
      { id: 'b', name: 'Tarjeta b', owed: 7000, hasValidCycle: true },
    ]);
  });

  it('el saldo inicial de la tarjeta cuenta como deuda', () => {
    const r = getRealMoney([], 20000, [card('a', { openingBalance: 8000 })], ref);
    expect(r.cards[0].owed).toBe(8000);
    expect(r.realMoney).toBe(12000);
  });

  it('el cashback plano se descuenta del saldo', () => {
    const r = getRealMoney([cardTx('a', 10000, '2026-05-10', 100)], 20000, [card('a')], ref);
    expect(r.cardsOwed).toBe(9900);
  });

  it('ejemplo del problema: efectivo 40,000 y tarjeta 55,000 → −15,000, crítico', () => {
    const r = getRealMoney([cardTx('a', 55000, '2026-05-10')], 40000, [card('a')], ref);
    expect(r.realMoney).toBe(-15000);
    expect(r.isCritical).toBe(true);
    expect(r.shortfall).toBe(15000);
  });

  it('dinero real exactamente 0 no es crítico', () => {
    const r = getRealMoney([cardTx('a', 5000, '2026-05-10')], 5000, [card('a')], ref);
    expect(r.realMoney).toBe(0);
    expect(r.isCritical).toBe(false);
  });

  it('coma flotante: −0.004 se redondea a centavos y no es crítico (faltante 0)', () => {
    const r = getRealMoney([cardTx('a', 100.004, '2026-05-10')], 100, [card('a')], ref);
    // Redondeado a centavos y sin −0: la celda no puede mostrar «-RD$ 0.00».
    expect(r.realMoney).toBe(0);
    expect(r.isCritical).toBe(false);
    expect(r.shortfall).toBe(0);
  });

  it('−0.01 ya es crítico', () => {
    const r = getRealMoney([cardTx('a', 100.01, '2026-05-10')], 100, [card('a')], ref);
    expect(r.isCritical).toBe(true);
    expect(r.shortfall).toBeCloseTo(0.01, 5);
  });

  it('tarjeta sin ciclo válido: resta todo su consumo y se cuenta en cardsWithoutCycle', () => {
    const cards = [card('a', { cutoffDay: NaN }), card('b')];
    const txs = [cardTx('a', 5000, '2026-05-10'), cardTx('b', 2000, '2026-05-10')];
    const r = getRealMoney(txs, 20000, cards, ref);
    expect(r.cardsWithoutCycle).toBe(1);
    expect(r.cardsOwed).toBe(7000);
    expect(r.realMoney).toBe(13000);
    expect(r.cards.map((c) => c.hasValidCycle)).toEqual([false, true]);
  });

  it('ingreso con cardId huérfano: sube el dinero real por su monto completo', () => {
    const txs = [{ ...cardTx('a', 5000, '2026-05-10'), type: 'income' }];
    const r = getRealMoney(txs, 20000, [card('a')], ref);
    expect(r.cardsOwed).toBe(0);
    expect(r.realMoney).toBe(25000);
  });

  it('ahorro con cardId huérfano: baja el dinero real solo por su monto', () => {
    const txs = [{ ...cardTx('a', 3000, '2026-05-10'), type: 'savings' }];
    const r = getRealMoney(txs, 20000, [card('a')], ref);
    expect(r.cardsOwed).toBe(0);
    expect(r.realMoney).toBe(17000);
  });

  it('sin datos → todo en 0 y sin estado crítico', () => {
    expect(getRealMoney([], 0, [], ref)).toEqual({
      cash: 0, cardsOwed: 0, realMoney: 0, isCritical: false, shortfall: 0, cards: [], cardsWithoutCycle: 0,
    });
  });

  it('sin tarjetas → dinero real = efectivo', () => {
    const txs = [tx('c1', 2000, 'income'), tx('c2', 500, 'variable_expense')];
    const r = getRealMoney(txs, 1000, [], ref);
    expect(r.realMoney).toBe(r.cash);
    expect(r.realMoney).toBe(2500);
  });

  it('saldo inicial ausente y cards ausentes se tratan como 0 / vacío', () => {
    const r = getRealMoney(undefined, undefined, undefined, ref);
    expect(r.realMoney).toBe(0);
    expect(r.cards).toEqual([]);
  });
});

describe('hasLegacyPaidCycles', () => {
  it('hay alguna tarjeta con paidCycles no vacío (formato string u objeto)', () => {
    expect(hasLegacyPaidCycles([{ id: 'a', paidCycles: [] }, { id: 'b', paidCycles: ['2026-05-20'] }])).toBe(true);
    expect(hasLegacyPaidCycles([{ id: 'a', paidCycles: [{ cycleEnd: '2026-05-20', amount: 1000 }] }])).toBe(true);
  });

  it('sin paidCycles, vacíos o ausentes → false', () => {
    expect(hasLegacyPaidCycles([{ id: 'a', paidCycles: [] }, { id: 'b' }])).toBe(false);
    expect(hasLegacyPaidCycles([{ id: 'a', paidCycles: null }])).toBe(false);
  });

  it('sin tarjetas o con tarjetas ausentes → false', () => {
    expect(hasLegacyPaidCycles([])).toBe(false);
    expect(hasLegacyPaidCycles(undefined)).toBe(false);
  });
});

// P7: «Mi dinero total» y el patrimonio restan el saldo pendiente COMPLETO de las
// tarjetas (facturado + ciclo abierto − abonos), la misma regla del dinero real.
describe('Mi dinero total y patrimonio: restan el saldo completo de tarjetas (P7)', () => {
  // Corte 25 / pago 5. A 15-mar el ciclo abierto va del 26-feb al 25-mar.
  const ref = new Date(2026, 2, 15);
  const card = (id, extra = {}) => ({ id, name: `Tarjeta ${id}`, cutoffDay: 25, dueDay: 5, payments: [], ...extra });
  const tx = (amount, type, date, extra = {}) => ({ categoryId: 'c1', amount, type, cashbackEarned: 0, date, ...extra });
  const txs = [
    tx(20000, 'income', '2026-02-01'),
    tx(3000, 'variable_expense', '2026-02-10', { cardId: 'a' }), // facturado
    tx(2000, 'variable_expense', '2026-03-05', { cardId: 'a' }), // ciclo abierto
  ];
  const savings = 4000;

  it('el punto de hoy de la serie diaria = dinero real + ahorro', () => {
    const cards = [card('a')];
    const last = getWealthTimeline(txs, 1000, 3, ref, cards, savings).at(-1);
    const real = getRealMoney(txs, 1000, cards, ref).realMoney;
    expect(last.cardsDue).toBe(5000); // facturado 3,000 + ciclo abierto 2,000
    expect(last.wealth).toBe(real + savings);
  });

  it('el último punto de la serie mensual también = dinero real + ahorro', () => {
    const cards = [card('a')];
    const last = getCumulativeLiquidWealth(txs, 1000, 3, ref, cards, savings).at(-1);
    expect(last.wealth).toBe(getRealMoney(txs, 1000, cards, ref).realMoney + savings);
  });

  it('con un abono a la tarjeta, el punto de hoy sigue atado al dinero real', () => {
    const cards = [card('a', { payments: [{ id: 'p', amount: 1500, date: '2026-03-10' }] })];
    const last = getWealthTimeline(txs, 1000, 3, ref, cards, savings).at(-1);
    expect(last.wealth).toBe(getRealMoney(txs, 1000, cards, ref).realMoney + savings);
  });

  it('cada punto pasado usa los consumos y abonos de ESE día, no los posteriores', () => {
    const cards = [card('a', { payments: [{ id: 'p', amount: 1500, date: '2026-03-10' }] })];
    const by = Object.fromEntries(getWealthTimeline(txs, 1000, 3, ref, cards, savings).map((p) => [p.key, p]));
    expect(by['2026-02-09'].cardsDue).toBe(0);    // aún sin consumo
    expect(by['2026-02-10'].cardsDue).toBe(3000); // el facturado
    expect(by['2026-03-04'].cardsDue).toBe(3000);
    expect(by['2026-03-05'].cardsDue).toBe(5000); // entra el ciclo abierto
    expect(by['2026-03-09'].cardsDue).toBe(5000); // el abono del 10 aún no ocurre
    expect(by['2026-03-10'].cardsDue).toBe(3500); // −1,500
  });

  it('un gasto con tarjeta de fecha futura (ciclo abierto) entra en el punto de hoy, igual que en el dinero real', () => {
    const conFuturo = [...txs, tx(300, 'variable_expense', '2026-03-20', { cardId: 'a' })];
    const cards = [card('a')];
    const by = Object.fromEntries(getWealthTimeline(conFuturo, 1000, 3, ref, cards, savings).map((p) => [p.key, p]));
    const last = by['2026-03-15'];
    expect(last.cardsDue).toBe(5300);
    expect(last.wealth).toBe(getRealMoney(conFuturo, 1000, cards, ref).realMoney + savings);
    expect(by['2026-03-14'].cardsDue).toBe(5000); // los días pasados no lo anticipan
  });

  it('un ingreso con cardId huérfano no mueve las tarjetas de la serie', () => {
    const huerfano = [...txs, tx(900, 'income', '2026-03-06', { cardId: 'a' })];
    const last = getWealthTimeline(huerfano, 1000, 3, ref, [card('a')], savings).at(-1);
    expect(last.cardsDue).toBe(5000);
  });

  it('getNetWorth = efectivo + ahorro − préstamos − saldo pendiente de tarjetas', () => {
    const cards = [card('a')];
    const r = getNetWorth(txs, 1000, cards, savings, 6000, ref);
    const real = getRealMoney(txs, 1000, cards, ref);
    expect(r.cash).toBe(real.cash);
    expect(r.cardsOwed).toBe(5000);
    expect(r.netWorth).toBe(real.realMoney + savings - 6000);
  });

  it('getNetWorth sin tarjetas ni préstamos = efectivo + ahorro', () => {
    const r = getNetWorth([tx(500, 'income', '2026-03-01')], 100, [], 50, 0, ref);
    expect(r.cardsOwed).toBe(0);
    expect(r.netWorth).toBe(650);
  });

  it('getNetWorth tolera datos ausentes', () => {
    expect(getNetWorth(undefined, undefined, undefined, undefined, undefined, ref).netWorth).toBe(0);
  });
});
