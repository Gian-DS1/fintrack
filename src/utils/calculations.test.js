import { describe, it, expect } from 'vitest';
import { getBudgetSummary, getBuckets503020, getBudgetGroupTotals } from './calculations';

const categories = [
  { id: 'inc', type: 'income' },
  { id: 'fix', type: 'fixed_expense' },
  { id: 'var', type: 'variable_expense' },
  { id: 'sav', type: 'savings' },
];

describe('getBudgetSummary', () => {
  it('calcula puedesGastar = ingreso recibido − reservas (fijo/ahorro/deuda) − variable gastado', () => {
    const r = getBudgetSummary({
      monthTransactions: [
        { categoryId: 'inc', amount: 50000 },
        { categoryId: 'var', amount: 3000 },
      ],
      monthBudgets: [
        { categoryId: 'fix', estimatedAmount: 20000 },
        { categoryId: 'sav', estimatedAmount: 5000 },
      ],
      categories,
      debtPlanned: 10000,
      debtPaid: 0,
    });
    expect(r.ingresoRecibido).toBe(50000);
    expect(r.comprometido).toBe(35000); // 20000 fijo + 10000 deuda + 5000 ahorro (sin sobre variable)
    expect(r.variableGastado).toBe(3000);
    expect(r.puedesGastar).toBe(12000);
    expect(r.estado).toBe('good');
  });

  it('comprometido incluye TODOS los sobres: fijos, variables, ahorro y deuda', () => {
    const r = getBudgetSummary({
      monthTransactions: [
        { categoryId: 'inc', amount: 50000 },
        { categoryId: 'var', amount: 3000 },
      ],
      monthBudgets: [
        { categoryId: 'fix', estimatedAmount: 20000 },
        { categoryId: 'var', estimatedAmount: 15000 },
        { categoryId: 'sav', estimatedAmount: 5000 },
      ],
      categories,
      debtPlanned: 10000,
      debtPaid: 0,
    });
    expect(r.comprometido).toBe(50000); // 20000 fijo + 15000 variable + 5000 ahorro + 10000 deuda
    expect(r.porAsignar).toBe(0); // 50000 ingreso − 50000 comprometido
    // El plan variable NO se resta de puedesGastar (ahí cuenta el gasto variable real).
    expect(r.puedesGastar).toBe(12000); // 50000 − 20000 − 5000 − 10000 − 3000
  });

  it('marca danger y puedesGastar 0 cuando lo comprometido supera el ingreso recibido', () => {
    const r = getBudgetSummary({
      monthTransactions: [{ categoryId: 'inc', amount: 30000 }],
      monthBudgets: [{ categoryId: 'fix', estimatedAmount: 35000 }],
      categories,
      debtPlanned: 0,
      debtPaid: 0,
    });
    expect(r.disponible).toBe(-5000);
    expect(r.puedesGastar).toBe(0);
    expect(r.estado).toBe('danger');
  });

  it('marca warning cuando el colchón es menor al 10% del ingreso recibido', () => {
    const r = getBudgetSummary({
      monthTransactions: [
        { categoryId: 'inc', amount: 50000 },
        { categoryId: 'var', amount: 1000 },
      ],
      monthBudgets: [{ categoryId: 'fix', estimatedAmount: 46000 }],
      categories,
      debtPlanned: 0,
      debtPaid: 0,
    });
    expect(r.disponible).toBe(3000); // < 5000 (10% de 50000)
    expect(r.estado).toBe('warning');
  });

  it('devuelve estado neutral cuando no hay ingreso recibido', () => {
    const r = getBudgetSummary({
      monthTransactions: [],
      monthBudgets: [{ categoryId: 'fix', estimatedAmount: 20000 }],
      categories,
      debtPlanned: 5000,
      debtPaid: 0,
    });
    expect(r.ingresoRecibido).toBe(0);
    expect(r.puedesGastar).toBe(0);
    expect(r.estado).toBe('neutral');
  });

  it('sin ingreso recibido, ingresoBase = estimado y porAsignar se calcula sobre él', () => {
    const r = getBudgetSummary({
      monthTransactions: [],
      monthBudgets: [
        { categoryId: 'inc', estimatedAmount: 60000 },
        { categoryId: 'fix', estimatedAmount: 20000 },
        { categoryId: 'var', estimatedAmount: 15000 },
        { categoryId: 'sav', estimatedAmount: 5000 },
      ],
      categories,
      debtPlanned: 10000,
      debtPaid: 0,
    });
    expect(r.ingresoBase).toBe(60000); // respaldo al estimado mientras recibido = 0
    expect(r.porAsignar).toBe(10000); // 60000 - 20000 - 15000 - 5000 - 10000
  });

  it('con ingreso recibido, ingresoBase = recibido y porAsignar lo ignora el estimado', () => {
    const r = getBudgetSummary({
      monthTransactions: [
        { categoryId: 'inc', amount: 50000 }, // entró el primer peso → manda lo recibido
      ],
      monthBudgets: [
        { categoryId: 'inc', estimatedAmount: 60000 }, // estimado debe ignorarse
        { categoryId: 'fix', estimatedAmount: 20000 },
        { categoryId: 'var', estimatedAmount: 15000 },
        { categoryId: 'sav', estimatedAmount: 5000 },
      ],
      categories,
      debtPlanned: 10000,
      debtPaid: 0,
    });
    expect(r.ingresoBase).toBe(50000);
    expect(r.porAsignar).toBe(0); // 50000 - 20000 - 15000 - 5000 - 10000
  });

  it('preserva la identidad comprometido + porAsignar = ingresoBase', () => {
    const r = getBudgetSummary({
      monthTransactions: [{ categoryId: 'inc', amount: 50000 }],
      monthBudgets: [
        { categoryId: 'fix', estimatedAmount: 20000 },
        { categoryId: 'var', estimatedAmount: 15000 },
        { categoryId: 'sav', estimatedAmount: 5000 },
      ],
      categories,
      debtPlanned: 10000,
      debtPaid: 0,
    });
    expect(r.comprometido + r.porAsignar).toBe(r.ingresoBase);
  });

  it('clasifica el gasto por el tipo de la categoría, no por transaction.type', () => {
    const r = getBudgetSummary({
      monthTransactions: [
        { categoryId: 'inc', amount: 40000 },
        { categoryId: 'var', amount: 2500, type: 'expense' }, // type genérico ignorado
      ],
      monthBudgets: [],
      categories,
      debtPlanned: 0,
      debtPaid: 0,
    });
    expect(r.variableGastado).toBe(2500);
  });

  it('expone el gastado real por tipo (gastosFijosReal, ahorroReal)', () => {
    const r = getBudgetSummary({
      monthTransactions: [
        { categoryId: 'inc', amount: 60000 },
        { categoryId: 'fix', amount: 18000 },
        { categoryId: 'var', amount: 7000 },
        { categoryId: 'sav', amount: 4000 },
      ],
      monthBudgets: [],
      categories,
      debtPlanned: 0,
      debtPaid: 0,
    });
    expect(r.gastosFijosReal).toBe(18000);
    expect(r.variableGastado).toBe(7000);
    expect(r.ahorroReal).toBe(4000);
  });

  it('restanteReal = ingresos reales - gastos fijos reales - gastos variables reales', () => {
    const r = getBudgetSummary({
      monthTransactions: [
        { categoryId: 'inc', amount: 50000 },
        { categoryId: 'fix', amount: 20000 },
        { categoryId: 'var', amount: 12000 },
      ],
      monthBudgets: [],
      categories,
      debtPlanned: 0,
      debtPaid: 0,
    });
    expect(r.gastosReal).toBe(32000);
    expect(r.restanteReal).toBe(18000); // 50000 - 20000 - 12000
  });

  it('restanteReal es negativo cuando se gasta más de lo que se gana', () => {
    const r = getBudgetSummary({
      monthTransactions: [
        { categoryId: 'inc', amount: 30000 },
        { categoryId: 'fix', amount: 25000 },
        { categoryId: 'var', amount: 15000 },
      ],
      monthBudgets: [],
      categories,
      debtPlanned: 0,
      debtPaid: 0,
    });
    expect(r.restanteReal).toBe(-10000);
  });

  it('restanteReal también descuenta deuda pagada y ahorro apartado (dinero que salió)', () => {
    const catsDebt = [...categories, { id: 'debt', type: 'fixed_expense', slug: 'pago-deuda' }];
    const r = getBudgetSummary({
      monthTransactions: [
        { categoryId: 'inc', amount: 60000 },
        { categoryId: 'fix', amount: 10000 },
        { categoryId: 'var', amount: 5000 },
        { categoryId: 'debt', amount: 8000 }, // pago de deuda real
        { categoryId: 'sav', amount: 4000 },  // ahorro apartado
      ],
      monthBudgets: [],
      categories: catsDebt,
      debtPlanned: 8000,
      debtPaid: 8000,
      debtCategoryId: 'debt',
    });
    expect(r.gastosReal).toBe(15000); // solo fijos + variables (la deuda vive aparte)
    expect(r.restanteReal).toBe(33000); // 60000 - 15000 - 8000 - 4000
  });

  it('restantePlan = ingreso presupuestado - plan de gastos - cuota de deuda - ahorro plan', () => {
    const r = getBudgetSummary({
      monthTransactions: [],
      monthBudgets: [
        { categoryId: 'inc', estimatedAmount: 60000 },
        { categoryId: 'fix', estimatedAmount: 20000 },
        { categoryId: 'var', estimatedAmount: 15000 },
        { categoryId: 'sav', estimatedAmount: 5000 },
      ],
      categories,
      debtPlanned: 10000,
      debtPaid: 0,
    });
    expect(r.gastosPlan).toBe(35000);
    expect(r.restantePlan).toBe(10000); // 60000 - 35000 - 10000 - 5000
  });

  it('restantePlan usa la cuota planificada, no el sobrepago real de deuda', () => {
    const catsDebt = [...categories, { id: 'debt', type: 'fixed_expense', slug: 'pago-deuda' }];
    const r = getBudgetSummary({
      monthTransactions: [{ categoryId: 'debt', amount: 13000 }],
      monthBudgets: [{ categoryId: 'inc', estimatedAmount: 50000 }],
      categories: catsDebt,
      debtPlanned: 10000,
      debtPaid: 13000, // sobrepago: afecta lo REAL, no el plan
      debtCategoryId: 'debt',
    });
    expect(r.restantePlan).toBe(40000); // 50000 - 10000 (cuota plan)
    expect(r.restanteReal).toBe(-13000); // 0 ingreso real - 13000 pagados
  });
});

describe('getBudgetGroupTotals', () => {
  // Grupo "Supermercados" = bravo + ccn + super (tres sobres que cubren lo mismo).
  const monthBudgets = [
    { categoryId: 'bravo', estimatedAmount: 3000 },
    { categoryId: 'ccn', estimatedAmount: 2000 },
    { categoryId: 'super', estimatedAmount: 5000 },
    { categoryId: 'otra', estimatedAmount: 9999 },
  ];
  const monthTransactions = [
    { categoryId: 'bravo', amount: 1500 },
    { categoryId: 'ccn', amount: 800, cashbackEarned: 50 },
    { categoryId: 'super', amount: 2000 },
    { categoryId: 'otra', amount: 7777 },
  ];

  it('suma estimado y gasto real (neto de cashback) solo de las categorías miembro', () => {
    const r = getBudgetGroupTotals({ categoryIds: ['bravo', 'ccn', 'super'], monthBudgets, monthTransactions });
    expect(r.estimated).toBe(10000);
    expect(r.actual).toBe(4250); // 1500 + (800-50) + 2000
    expect(r.pct).toBe(42.5);
  });

  it('sin presupuesto asignado el pct es 0 (sin dividir entre cero)', () => {
    const r = getBudgetGroupTotals({ categoryIds: ['bravo'], monthBudgets: [], monthTransactions });
    expect(r.estimated).toBe(0);
    expect(r.actual).toBe(1500);
    expect(r.pct).toBe(0);
  });

  it('grupo vacío devuelve todo en 0', () => {
    const r = getBudgetGroupTotals({ categoryIds: [], monthBudgets, monthTransactions });
    expect(r).toEqual({ estimated: 0, actual: 0, pct: 0 });
  });
});

describe('getBuckets503020', () => {
  const summaryFor = (over) => getBudgetSummary({
    monthTransactions: [
      { categoryId: 'inc', amount: 100000 },
      { categoryId: 'fix', amount: over ? 60000 : 40000 }, // necesidades
      { categoryId: 'var', amount: 20000 },                // gustos
      { categoryId: 'sav', amount: 10000 },                // ahorro
    ],
    monthBudgets: [],
    categories,
    debtPlanned: 0,
    debtPaid: 5000, // se suma al balde ahorro/deuda
  });

  it('calcula límites 50/30/20 sobre el ingreso recibido', () => {
    const b = getBuckets503020(summaryFor(false));
    expect(b.income).toBe(100000);
    expect(b.necesidades.limit).toBe(50000);
    expect(b.gustos.limit).toBe(30000);
    expect(b.ahorroDeuda.limit).toBe(20000);
  });

  it('mapea el gastado real por balde (ahorro incluye el pago de deuda)', () => {
    const b = getBuckets503020(summaryFor(false));
    expect(b.necesidades.spent).toBe(40000);
    expect(b.gustos.spent).toBe(20000);
    expect(b.ahorroDeuda.spent).toBe(15000); // 10000 ahorro + 5000 deuda
    expect(b.necesidades.pct).toBe(80); // 40000/50000
  });

  it('pct supera 100 cuando un balde se sobregasta', () => {
    const b = getBuckets503020(summaryFor(true));
    expect(b.necesidades.spent).toBe(60000);
    expect(b.necesidades.pct).toBe(120); // 60000/50000
  });

  it('con ingreso 0 devuelve límites y pct en 0 (sin NaN ni Infinity)', () => {
    const b = getBuckets503020(getBudgetSummary({
      monthTransactions: [{ categoryId: 'var', amount: 3000 }],
      monthBudgets: [],
      categories,
      debtPlanned: 0,
      debtPaid: 0,
    }));
    expect(b.income).toBe(0);
    expect(b.necesidades.limit).toBe(0);
    expect(b.gustos.pct).toBe(0);
    expect(Number.isFinite(b.gustos.pct)).toBe(true);
  });
});

describe('getBudgetSummary — invariante anti doble-conteo de deuda', () => {
  // Categoría de deuda (slug pago-deuda) clasificada como fixed_expense, igual
  // que defaultCategories. Las transacciones de pago de deuda viven aquí.
  const catsDebt = [...categories, { id: 'debt', type: 'fixed_expense', slug: 'pago-deuda' }];

  it('un pago de deuda real (gasto fijo) NO reduce puedesGastar; solo lo hace el plan de deuda', () => {
    // El pago de deuda crea una transacción fixed_expense Y debtPlanned entra en
    // comprometido. puedesGastar debe restar SOLO el plan, nunca también el gasto
    // fijo real, o la deuda se contaría dos veces.
    const r = getBudgetSummary({
      monthTransactions: [
        { categoryId: 'inc', amount: 50000 },
        { categoryId: 'fix', amount: 8000 }, // pago de deuda real (gasto fijo)
      ],
      monthBudgets: [],
      categories,
      debtPlanned: 10000,
      debtPaid: 8000,
    });
    expect(r.comprometido).toBe(10000); // solo el plan de deuda
    expect(r.puedesGastar).toBe(40000); // 50000 - 10000, el 8000 fijo NO se resta
  });

  it('un sobre puesto a la categoría de deuda NO se suma a comprometido (sin doble conteo)', () => {
    const r = getBudgetSummary({
      monthTransactions: [{ categoryId: 'inc', amount: 50000 }],
      // El usuario presupuestó 9000 a la categoría de deuda: NO debe contar,
      // porque la cuota (debtPlanned) ya la compromete.
      monthBudgets: [{ categoryId: 'debt', estimatedAmount: 9000 }],
      categories: catsDebt,
      debtPlanned: 10000,
      debtPaid: 0,
      debtCategoryId: 'debt',
    });
    expect(r.gastosFijosPlan).toBe(0); // el sobre de deuda se excluye
    expect(r.comprometido).toBe(10000); // solo la cuota, no 10000 + 9000
  });

  it('una transacción de pago de deuda NO entra en gastosFijosReal (vive aparte)', () => {
    const r = getBudgetSummary({
      monthTransactions: [
        { categoryId: 'inc', amount: 50000 },
        { categoryId: 'debt', amount: 8000 }, // pago de deuda real
        { categoryId: 'fix', amount: 3000 },  // gasto fijo normal
      ],
      monthBudgets: [],
      categories: catsDebt,
      debtPlanned: 10000,
      debtPaid: 8000,
      debtCategoryId: 'debt',
    });
    expect(r.gastosFijosReal).toBe(3000); // solo el gasto fijo normal, no 11000
  });

  it('comprometido usa max(cuota, pagado): cuota > pagado → cuota', () => {
    const r = getBudgetSummary({
      monthTransactions: [{ categoryId: 'inc', amount: 50000 }, { categoryId: 'debt', amount: 6000 }],
      monthBudgets: [],
      categories: catsDebt,
      debtPlanned: 10000,
      debtPaid: 6000,
      debtCategoryId: 'debt',
    });
    expect(r.debtCommitted).toBe(10000);
    expect(r.comprometido).toBe(10000);
    expect(r.puedesGastar).toBe(40000);
  });

  it('comprometido usa max(cuota, pagado): pagado > cuota → pagado (refleja sobrepago)', () => {
    const r = getBudgetSummary({
      monthTransactions: [{ categoryId: 'inc', amount: 50000 }, { categoryId: 'debt', amount: 13000 }],
      monthBudgets: [],
      categories: catsDebt,
      debtPlanned: 10000,
      debtPaid: 13000,
      debtCategoryId: 'debt',
    });
    expect(r.debtCommitted).toBe(13000);
    expect(r.comprometido).toBe(13000);
    expect(r.puedesGastar).toBe(37000);
  });

  it('cuota 0 con pago real: compromete lo pagado (no ignora la deuda)', () => {
    const r = getBudgetSummary({
      monthTransactions: [{ categoryId: 'inc', amount: 50000 }, { categoryId: 'debt', amount: 5000 }],
      monthBudgets: [],
      categories: catsDebt,
      debtPlanned: 0,
      debtPaid: 5000,
      debtCategoryId: 'debt',
    });
    expect(r.debtCommitted).toBe(5000);
    expect(r.comprometido).toBe(5000);
  });

  it('sin debtPaid explícito, deriva el pagado de las transacciones de la categoría de deuda', () => {
    const r = getBudgetSummary({
      monthTransactions: [{ categoryId: 'inc', amount: 50000 }, { categoryId: 'debt', amount: 12000 }],
      monthBudgets: [],
      categories: catsDebt,
      debtPlanned: 10000,
      // debtPaid omitido: debe usar las tx de la categoría de deuda (12000)
      debtCategoryId: 'debt',
    });
    expect(r.debtCommitted).toBe(12000); // max(10000, 12000 derivado de tx)
  });
});

describe('getBudgetSummary — categorías acumulativas', () => {
  const cats = [
    { id: 'inc', type: 'income' },
    { id: 'var', type: 'variable_expense' },
    { id: 'mar', type: 'variable_expense', isAccumulative: true },
  ];

  it('reserva el aporte y excluye el gasto del bote de puedesGastar', () => {
    const r = getBudgetSummary({
      monthTransactions: [
        { categoryId: 'inc', amount: 50000 },
        { categoryId: 'var', amount: 2000 },
        { categoryId: 'mar', amount: 11000 },
      ],
      monthBudgets: [{ categoryId: 'mar', estimatedAmount: 1000 }],
      categories: cats,
      debtPlanned: 0,
      debtPaid: 0,
    });
    expect(r.accumulativePlan).toBe(1000);
    expect(r.accumulativeSpent).toBe(11000);
    expect(r.variableGastado).toBe(2000);
    expect(r.comprometido).toBe(1000);
    expect(r.puedesGastar).toBe(47000);
  });
});
