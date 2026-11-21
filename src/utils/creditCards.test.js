import { describe, it, expect } from 'vitest';
import { getCardCycles, getStatementAmount, isStatementPaid, computeCashback, getStatementHistory, getLifetimeCashback, paidCyclesToPayments, getCardBalances, tierPercentage, getDerivedCashback, getTransactionCashback, hasTieredRule, normalizeCashbackRules, getCardOutstanding, hasValidCardCycle } from './creditCards';

describe('getCardCycles', () => {
  it('corte 20 / pago 5: el pago cae el mes siguiente al corte', () => {
    const c = getCardCycles({ cutoffDay: 20, dueDay: 5 }, new Date(2026, 4, 28));
    expect(c.lastCutoffISO).toBe('2026-05-20');
    expect(c.nextCutoffISO).toBe('2026-06-20');
    expect(c.openStartISO).toBe('2026-05-21');
    expect(c.openEndISO).toBe('2026-06-20');
    expect(c.closedStartISO).toBe('2026-04-21');
    expect(c.closedEndISO).toBe('2026-05-20');
    expect(c.dueDateISO).toBe('2026-06-05');
  });

  it('corte 5 / pago 25: el pago cae el mismo mes del corte', () => {
    const c = getCardCycles({ cutoffDay: 5, dueDay: 25 }, new Date(2026, 4, 28));
    expect(c.lastCutoffISO).toBe('2026-05-05');
    expect(c.nextCutoffISO).toBe('2026-06-05');
    expect(c.closedStartISO).toBe('2026-04-06');
    expect(c.closedEndISO).toBe('2026-05-05');
    expect(c.dueDateISO).toBe('2026-05-25');
  });

  it('ajusta el día 31 a meses cortos (febrero)', () => {
    const c = getCardCycles({ cutoffDay: 31, dueDay: 15 }, new Date(2026, 1, 15));
    expect(c.lastCutoffISO).toBe('2026-01-31');
    expect(c.nextCutoffISO).toBe('2026-02-28');
  });
});

describe('getStatementAmount', () => {
  it('suma solo las transacciones de esa tarjeta dentro de la ventana', () => {
    const txs = [
      { cardId: 'c1', date: '2026-05-10', amount: 1000 },
      { cardId: 'c1', date: '2026-05-25', amount: 500 },
      { cardId: 'c2', date: '2026-05-10', amount: 999 },
      { cardId: 'c1', date: '2026-04-30', amount: 200 },
    ];
    expect(getStatementAmount(txs, 'c1', '2026-05-01', '2026-05-20')).toBe(1000);
  });
});

describe('isStatementPaid', () => {
  it('detecta el ciclo marcado como pagado (formato legado: strings)', () => {
    const card = { paidCycles: ['2026-05-20'] };
    expect(isStatementPaid(card, '2026-05-20')).toBe(true);
    expect(isStatementPaid(card, '2026-06-20')).toBe(false);
  });

  it('detecta el ciclo pagado (formato nuevo: objetos snapshot)', () => {
    const card = { paidCycles: [{ cycleEnd: '2026-05-20', amount: 1000, cashback: 30 }] };
    expect(isStatementPaid(card, '2026-05-20')).toBe(true);
    expect(isStatementPaid(card, '2026-06-20')).toBe(false);
  });

  it('soporta historiales mixtos (string + objeto)', () => {
    const card = { paidCycles: ['2026-04-20', { cycleEnd: '2026-05-20', cashback: 30 }] };
    expect(isStatementPaid(card, '2026-04-20')).toBe(true);
    expect(isStatementPaid(card, '2026-05-20')).toBe(true);
  });
});

describe('getStatementHistory / getLifetimeCashback', () => {
  it('ordena del más reciente al más antiguo y normaliza strings legados', () => {
    const card = { paidCycles: ['2026-03-20', { cycleEnd: '2026-05-20', amount: 1000, cashback: 30 }] };
    const hist = getStatementHistory(card);
    expect(hist.map((h) => h.cycleEnd)).toEqual(['2026-05-20', '2026-03-20']);
    expect(hist[1].cashback).toBe(0); // el legado no tenía cashback
  });

  it('suma el cashback de por vida desde las transacciones de la tarjeta', () => {
    const txs = [
      { cardId: 'c1', cashbackEarned: 12.5 },
      { cardId: 'c1', cashbackEarned: 30 },
      { cardId: 'c2', cashbackEarned: 99 },
    ];
    expect(getLifetimeCashback({ id: 'c1' }, txs)).toBe(42.5);
  });

  it('devuelve vacío/0 si no hay historial', () => {
    expect(getStatementHistory({})).toEqual([]);
    expect(getLifetimeCashback({})).toBe(0);
    expect(getLifetimeCashback({ id: 'c1' }, [])).toBe(0);
  });
});

describe('computeCashback', () => {
  const card = {
    cashbackRules: [
      { categoryId: 'super', percentage: 3 },
      { categoryId: 'all', percentage: 1 },
    ],
  };

  it('aplica la regla de la categoría específica', () => {
    expect(computeCashback(card, 'super', 1000)).toBe(30);
  });

  it("usa la regla 'all' cuando no hay regla específica", () => {
    expect(computeCashback(card, 'otra', 1000)).toBe(10);
  });

  it('devuelve 0 si la tarjeta no tiene reglas o el monto es inválido', () => {
    expect(computeCashback({ cashbackRules: [] }, 'super', 1000)).toBe(0);
    expect(computeCashback(card, 'super', 0)).toBe(0);
    expect(computeCashback(null, 'super', 1000)).toBe(0);
  });

  it('soporta porcentajes con decimales', () => {
    expect(computeCashback({ cashbackRules: [{ categoryId: 'all', percentage: 1.5 }] }, 'x', 150)).toBe(2.25);
  });
});

describe('paidCyclesToPayments', () => {
  it('convierte entradas objeto netas de cashback (el snapshot guardó el bruto)', () => {
    const card = { id: 'c1', cutoffDay: 20, paidCycles: [
      { cycleEnd: '2026-04-20', amount: 8000, cashback: 200, paidAt: '2026-05-01' },
    ] };
    const out = paidCyclesToPayments(card, []);
    expect(out).toEqual([
      { id: 'mig-2026-04-20', amount: 7800, date: '2026-05-01', note: 'Migrado: estado de cuenta pagado' },
    ]);
  });

  it('reconstruye el monto de entradas string legado desde las transacciones', () => {
    const card = { id: 'c1', cutoffDay: 20, paidCycles: ['2026-04-20'] };
    // Ventana del ciclo que cierra el 2026-04-20: (2026-03-21 .. 2026-04-20)
    const txs = [
      { cardId: 'c1', date: '2026-04-10', amount: 3000, cashbackEarned: 0 },
      { cardId: 'c1', date: '2026-05-10', amount: 9999, cashbackEarned: 0 }, // fuera de la ventana
    ];
    const out = paidCyclesToPayments(card, txs);
    expect(out).toEqual([
      { id: 'mig-2026-04-20', amount: 3000, date: '2026-04-20', note: 'Migrado: estado de cuenta pagado' },
    ]);
  });

  it('descarta entradas que dan monto 0 y soporta tarjetas sin paidCycles', () => {
    expect(paidCyclesToPayments({ id: 'c1', cutoffDay: 20, paidCycles: ['2026-04-20'] }, [])).toEqual([]);
    expect(paidCyclesToPayments({ id: 'c1', cutoffDay: 20 }, [])).toEqual([]);
    expect(paidCyclesToPayments(null, [])).toEqual([]);
  });

  it('resta el cashback al reconstruir el monto de una entrada legada', () => {
    const card = { id: 'c1', cutoffDay: 20, paidCycles: ['2026-04-20'] };
    const txs = [{ cardId: 'c1', date: '2026-04-10', amount: 3000, cashbackEarned: 100 }];
    expect(paidCyclesToPayments(card, txs)).toEqual([
      { id: 'mig-2026-04-20', amount: 2900, date: '2026-04-20', note: 'Migrado: estado de cuenta pagado' },
    ]);
  });
});

describe('getCardBalances', () => {
  const card = { id: 'c1', cutoffDay: 20, dueDay: 5, payments: [] };
  const ref = new Date(2026, 4, 28); // corte 2026-05-20, pago 2026-06-05

  it('caso clienta: paga al corte, arrastra el ciclo abierto', () => {
    const txs = [
      { cardId: 'c1', date: '2026-05-10', amount: 10000, cashbackEarned: 0 }, // facturado
      { cardId: 'c1', date: '2026-05-25', amount: 5000, cashbackEarned: 0 },  // ciclo abierto
    ];
    const b0 = getCardBalances(card, txs, ref);
    expect(b0.billed).toBe(10000);
    expect(b0.open).toBe(5000);
    expect(b0.pendingBilled).toBe(10000);
    expect(b0.openCycle).toBe(5000);
    expect(b0.totalBalance).toBe(15000);
    expect(b0.isPaid).toBe(false);

    const paidCard = { ...card, payments: [{ id: 'a1', amount: 10000, date: '2026-05-21' }] };
    const b1 = getCardBalances(paidCard, txs, ref);
    expect(b1.pendingBilled).toBe(0);
    expect(b1.isPaid).toBe(true);
    expect(b1.openCycle).toBe(5000);
    expect(b1.totalBalance).toBe(5000);
  });

  it('caso sobregasto: abono parcial deja saldo arrastrado', () => {
    const txs = [{ cardId: 'c1', date: '2026-05-10', amount: 20000, cashbackEarned: 0 }];
    const c1 = { ...card, payments: [{ id: 'a1', amount: 12000, date: '2026-05-21' }] };
    expect(getCardBalances(c1, txs, ref).pendingBilled).toBe(8000);
    const c2 = { ...card, payments: [
      { id: 'a1', amount: 12000, date: '2026-05-21' },
      { id: 'a2', amount: 3000, date: '2026-05-28' },
    ] };
    expect(getCardBalances(c2, txs, ref).pendingBilled).toBe(5000);
  });

  it('sobre-abono (prepago): el excedente reduce el ciclo abierto, nada negativo', () => {
    const txs = [
      { cardId: 'c1', date: '2026-05-10', amount: 10000, cashbackEarned: 0 },
      { cardId: 'c1', date: '2026-05-25', amount: 5000, cashbackEarned: 0 },
    ];
    const c = { ...card, payments: [{ id: 'a1', amount: 12000, date: '2026-05-21' }] };
    const b = getCardBalances(c, txs, ref);
    expect(b.pendingBilled).toBe(0);
    expect(b.overpay).toBe(2000);
    expect(b.openCycle).toBe(3000);
    expect(b.totalBalance).toBe(3000);
  });

  it('spansMultipleCycles cuando hay saldo de meses anteriores sin pagar', () => {
    const txs = [
      { cardId: 'c1', date: '2026-03-10', amount: 5000, cashbackEarned: 0 },  // ciclo viejo
      { cardId: 'c1', date: '2026-05-10', amount: 10000, cashbackEarned: 0 }, // ciclo actual
    ];
    expect(getCardBalances({ ...card }, txs, ref).spansMultipleCycles).toBe(true);
    const conAbono = { ...card, payments: [{ id: 'a1', amount: 5000, date: '2026-05-21' }] };
    expect(getCardBalances(conAbono, txs, ref).spansMultipleCycles).toBe(false);
  });

  it('descuenta el cashback del monto facturado', () => {
    const txs = [{ cardId: 'c1', date: '2026-05-10', amount: 10000, cashbackEarned: 300 }];
    expect(getCardBalances(card, txs, ref).billed).toBe(9700);
    expect(getCardBalances(card, txs, ref).pendingBilled).toBe(9700);
  });

  it('un paidCycle legado cuenta como abonado (saldo cuadra)', () => {
    const txs = [{ cardId: 'c1', date: '2026-04-10', amount: 8000, cashbackEarned: 0 }];
    const legacy = { id: 'c1', cutoffDay: 20, dueDay: 5, payments: [],
      paidCycles: [{ cycleEnd: '2026-04-20', amount: 8000, paidAt: '2026-05-01' }] };
    const b = getCardBalances(legacy, txs, ref);
    expect(b.billed).toBe(8000);
    expect(b.paid).toBe(8000);
    expect(b.pendingBilled).toBe(0);
    expect(b.isPaid).toBe(true);
  });

  // Saldo inicial (deuda previa al empezar a usar la app).
  it('openingBalance se suma a la deuda por pagar, sin transacciones', () => {
    const c = { ...card, openingBalance: 12000 };
    const b = getCardBalances(c, [], ref);
    expect(b.billed).toBe(12000);
    expect(b.pendingBilled).toBe(12000);
    expect(b.openCycle).toBe(0);
    expect(b.totalBalance).toBe(12000);
    expect(b.isPaid).toBe(false);
  });

  it('openingBalance se combina con consumos facturados y se puede abonar', () => {
    const txs = [{ cardId: 'c1', date: '2026-05-10', amount: 5000, cashbackEarned: 0 }];
    const c = { ...card, openingBalance: 10000 };
    const b = getCardBalances(c, txs, ref);
    expect(b.billed).toBe(15000); // 10000 previo + 5000 facturado
    expect(b.pendingBilled).toBe(15000);
    const pagado = { ...c, payments: [{ id: 'a1', amount: 15000, date: '2026-05-21' }] };
    expect(getCardBalances(pagado, txs, ref).isPaid).toBe(true);
  });

  it('sin openingBalance (o 0) el comportamiento no cambia', () => {
    const txs = [{ cardId: 'c1', date: '2026-05-10', amount: 7000, cashbackEarned: 0 }];
    expect(getCardBalances({ ...card, openingBalance: 0 }, txs, ref).billed).toBe(7000);
    expect(getCardBalances({ ...card }, txs, ref).billed).toBe(7000); // sin la prop
  });
});

// Regresión (reporte de usuario, jul 2026): un abono PARCIAL a una tarjeta tipo
// Mastercard Plus CCN se tomó como si saldara todo el balance al corte. El
// invariante que protege a TODAS las tarjetas (y las que se agreguen): un abono
// menor al pendiente reduce pendingBilled exactamente por su monto y NUNCA
// marca el estado de cuenta como pagado.
describe('getCardBalances — invariante de abono parcial (caso Mastercard Plus CCN)', () => {
  // Perfil real: cashback escalonado (no congelado por transacción), saldo
  // inicial previo a la app y un ciclo legado ya pagado en formato objeto.
  const ccnCard = {
    id: 'ccn1', cutoffDay: 20, dueDay: 5,
    openingBalance: 4000,
    paidCycles: [{ cycleEnd: '2026-05-20', amount: 4000, paidAt: '2026-06-01' }],
    payments: [],
    cashbackRules: [
      { categoryId: 'ccn', tiers: [
        { upTo: 7999, pct: 5 },
        { upTo: 19999, pct: 6 },
        { upTo: Infinity, pct: 8 },
      ] },
    ],
  };
  const ref = new Date(2026, 6, 16); // corte 2026-06-20 cerrado, hoy 16 jul 2026
  const txs = [
    { cardId: 'ccn1', categoryId: 'ccn', amount: 4000, date: '2026-05-10', cashbackEarned: 0 },  // ciclo legado pagado
    { cardId: 'ccn1', categoryId: 'ccn', amount: 9000, date: '2026-06-10', cashbackEarned: 0 },  // facturado (corte 20 jun)
    { cardId: 'ccn1', categoryId: 'ccn', amount: 2500, date: '2026-07-05', cashbackEarned: 0 },  // ciclo abierto
  ];

  it('sin abonos: por pagar = saldo inicial + facturado no pagado', () => {
    const b = getCardBalances(ccnCard, txs, ref);
    expect(b.pendingBilled).toBe(13000); // 4000 inicial + 9000 facturado
    expect(b.isPaid).toBe(false);
  });

  it('abono parcial: reduce el corte EXACTAMENTE por el monto, nunca lo salda', () => {
    const conAbono = { ...ccnCard, payments: [{ id: 'a1', amount: 5000, date: '2026-07-15' }] };
    const b = getCardBalances(conAbono, txs, ref);
    expect(b.pendingBilled).toBe(8000);   // 13000 − 5000
    expect(b.isPaid).toBe(false);         // JAMÁS "al día" con abono parcial
    expect(b.overpay).toBe(0);            // sin prepago fantasma
    expect(b.openCycle).toBe(2500);       // el ciclo abierto no se toca
  });

  it('abonos parciales sucesivos: cada uno descuenta, isPaid solo al cubrir todo', () => {
    const pagos = [
      { id: 'a1', amount: 5000, date: '2026-07-10' },
      { id: 'a2', amount: 7999.99, date: '2026-07-15' },
    ];
    const casi = { ...ccnCard, payments: pagos };
    const b1 = getCardBalances(casi, txs, ref);
    expect(b1.pendingBilled).toBeCloseTo(0.01, 5);
    const completo = { ...ccnCard, payments: [...pagos, { id: 'a3', amount: 0.01, date: '2026-07-16' }] };
    const b2 = getCardBalances(completo, txs, ref);
    expect(b2.pendingBilled).toBe(0);
    expect(b2.isPaid).toBe(true);
  });

  it('el abono parcial de un monto tecleado nunca se infla por cashback escalonado', () => {
    // El cashback de tiers NO está congelado en cashbackEarned, así que no debe
    // alterar ni billed ni paid: el descuento es 1:1 con el monto abonado.
    const conAbono = { ...ccnCard, payments: [{ id: 'a1', amount: 1234.56, date: '2026-07-15' }] };
    const b = getCardBalances(conAbono, txs, ref);
    expect(b.pendingBilled).toBeCloseTo(13000 - 1234.56, 5);
  });
});

describe('tierPercentage — nivel escalonado por monto acumulado', () => {
  const tiers = [
    { upTo: 7999, pct: 5 },
    { upTo: 19999, pct: 6 },
    { upTo: Infinity, pct: 8 },
  ];

  it('aplica 5% por debajo del primer umbral', () => {
    expect(tierPercentage(tiers, 5000)).toBe(5);
    expect(tierPercentage(tiers, 7999)).toBe(5);
  });
  it('aplica 6% en el tramo medio', () => {
    expect(tierPercentage(tiers, 8000)).toBe(6);
    expect(tierPercentage(tiers, 19999)).toBe(6);
  });
  it('aplica 8% desde el umbral superior', () => {
    expect(tierPercentage(tiers, 20000)).toBe(8);
    expect(tierPercentage(tiers, 100000)).toBe(8);
  });
  it('monto 0 o negativo → 0%', () => {
    expect(tierPercentage(tiers, 0)).toBe(0);
    expect(tierPercentage(tiers, -10)).toBe(0);
  });
  it('sin tiers → 0%', () => {
    expect(tierPercentage([], 5000)).toBe(0);
    expect(tierPercentage(null, 5000)).toBe(0);
  });
});

describe('getDerivedCashback — cashback CCN acumulado por CICLO DE CORTE', () => {
  // Tarjeta CCN con corte el día 25. El ciclo abierto se mide entre cortes:
  // (corte anterior, próximo corte]. El acumulado para el nivel es ese rango,
  // NO el mes calendario.
  const card = {
    id: 'card1', cutoffDay: 25, dueDay: 5,
    cashbackRules: [
      { categoryId: 'ccn', tiers: [
        { upTo: 7999, pct: 5 },
        { upTo: 19999, pct: 6 },
        { upTo: Infinity, pct: 8 },
      ] },
    ],
  };
  // refDate = 7 jun 2026 → ciclo abierto: 26 may 2026 a 25 jun 2026.
  const ref = new Date(2026, 5, 7);
  const txs = [
    // Dentro del ciclo (26 may–25 jun): 5000 + 6000 + 12000 = 23000 → nivel 8%.
    { cardId: 'card1', categoryId: 'ccn', amount: 5000, date: '2026-05-28' },
    { cardId: 'card1', categoryId: 'ccn', amount: 6000, date: '2026-06-10' },
    { cardId: 'card1', categoryId: 'ccn', amount: 12000, date: '2026-06-24' },
    // Fuera del ciclo: antes del corte anterior (ciclo previo).
    { cardId: 'card1', categoryId: 'ccn', amount: 9999, date: '2026-05-20' },
    // En el día del próximo corte +1 (ya es el siguiente ciclo): no cuenta.
    { cardId: 'card1', categoryId: 'ccn', amount: 9999, date: '2026-06-26' },
    // Otra tarjeta / otra categoría: no cuentan.
    { cardId: 'otra', categoryId: 'ccn', amount: 9999, date: '2026-06-10' },
    { cardId: 'card1', categoryId: 'super', amount: 9999, date: '2026-06-10' },
  ];

  it('hasTieredRule detecta la regla escalonada', () => {
    expect(hasTieredRule(card)).toBe(true);
    expect(hasTieredRule({ cashbackRules: [{ categoryId: 'x', percentage: 1 }] })).toBe(false);
  });

  it('acumula solo las transacciones del ciclo de corte y aplica ese nivel', () => {
    // Acumulado del ciclo 26 may–25 jun = 23000 → 8%. Cashback = 23000 * 8% = 1840.
    expect(getDerivedCashback(card, txs, ref)).toBe(1840);
  });

  it('una transacción justo en el corte anterior NO entra; el día siguiente SÍ', () => {
    // El ciclo abierto arranca el día DESPUÉS del corte (openStartISO).
    const onlyCutoffDay = [{ cardId: 'card1', categoryId: 'ccn', amount: 5000, date: '2026-05-25' }];
    expect(getDerivedCashback(card, onlyCutoffDay, ref)).toBe(0); // 25 = corte anterior, fuera
    const dayAfter = [{ cardId: 'card1', categoryId: 'ccn', amount: 5000, date: '2026-05-26' }];
    expect(getDerivedCashback(card, dayAfter, ref)).toBe(250); // 5000 * 5%
  });

  it('ciclo sin consumo CCN → 0', () => {
    const otherRef = new Date(2026, 7, 7); // ago: ciclo 26 jul–25 ago, sin txs CCN
    expect(getDerivedCashback(card, txs, otherRef)).toBe(0);
  });

  it('tarjeta sin regla escalonada → 0', () => {
    const flat = { id: 'card1', cutoffDay: 25, dueDay: 5, cashbackRules: [{ categoryId: 'ccn', percentage: 5 }] };
    expect(getDerivedCashback(flat, txs, ref)).toBe(0);
  });
});

describe('getTransactionCashback — cashback estimado por transacción', () => {
  const tieredCard = {
    id: 'card1', cutoffDay: 25, dueDay: 5,
    cashbackRules: [
      { categoryId: 'ccn', tiers: [
        { upTo: 7999, pct: 5 },
        { upTo: 19999, pct: 6 },
        { upTo: Infinity, pct: 8 },
      ] },
    ],
  };
  const flatCard = {
    id: 'card2', cashbackRules: [{ categoryId: 'super', percentage: 3 }, { categoryId: 'all', percentage: 1 }],
  };
  // refDate = 7 jun 2026 → ciclo abierto: 26 may 2026 a 25 jun 2026.
  const ref = new Date(2026, 5, 7);

  it('tarjeta plana: delega en computeCashback (% por transacción)', () => {
    const tx = { cardId: 'card2', categoryId: 'super', amount: 1000, date: '2026-06-10' };
    expect(getTransactionCashback(flatCard, tx, [tx], ref)).toBe(30);
  });

  it('tarjeta escalonada: aplica el % del nivel del ciclo al monto de la transacción', () => {
    // Ciclo acumula 23000 (5000+6000+12000) → nivel 8%. Cada fila estima 8% de su monto.
    const txs = [
      { cardId: 'card1', categoryId: 'ccn', amount: 5000, date: '2026-05-28' },
      { cardId: 'card1', categoryId: 'ccn', amount: 6000, date: '2026-06-10' },
      { cardId: 'card1', categoryId: 'ccn', amount: 12000, date: '2026-06-24' },
    ];
    expect(getTransactionCashback(tieredCard, txs[0], txs, ref)).toBe(400);  // 5000 * 8%
    expect(getTransactionCashback(tieredCard, txs[1], txs, ref)).toBe(480);  // 6000 * 8%
    expect(getTransactionCashback(tieredCard, txs[2], txs, ref)).toBe(960);  // 12000 * 8%
  });

  it('la suma de las filas del ciclo iguala getDerivedCashback', () => {
    const txs = [
      { cardId: 'card1', categoryId: 'ccn', amount: 5000, date: '2026-05-28' },
      { cardId: 'card1', categoryId: 'ccn', amount: 6000, date: '2026-06-10' },
      { cardId: 'card1', categoryId: 'ccn', amount: 12000, date: '2026-06-24' },
    ];
    const sum = txs.reduce((s, t) => s + getTransactionCashback(tieredCard, t, txs, ref), 0);
    expect(sum).toBeCloseTo(getDerivedCashback(tieredCard, txs, ref), 2);
  });

  it('transacción de otra categoría en tarjeta escalonada → 0', () => {
    const txs = [{ cardId: 'card1', categoryId: 'super', amount: 5000, date: '2026-06-10' }];
    expect(getTransactionCashback(tieredCard, txs[0], txs)).toBe(0);
  });

  it('sin tarjeta o monto inválido → 0', () => {
    expect(getTransactionCashback(null, { amount: 1000 }, [])).toBe(0);
    expect(getTransactionCashback(tieredCard, { cardId: 'card1', categoryId: 'ccn', amount: 0, date: '2026-06-10' }, [])).toBe(0);
  });

  it('transacción de un CICLO PASADO: usa el acumulado de SU propio ciclo', () => {
    // Una transacción del ciclo anterior (26 abr–25 may) estima su cashback con
    // el acumulado de ESE ciclo, no del actual.
    const txs = [
      // Ciclo abril–mayo (26 abr–25 may): 5000 → nivel 5%.
      { cardId: 'card1', categoryId: 'ccn', amount: 5000, date: '2026-05-10' },
      // Ciclo actual (26 may–25 jun): 12000 → nivel 6%.
      { cardId: 'card1', categoryId: 'ccn', amount: 12000, date: '2026-06-10' },
    ];
    // La del ciclo pasado: 5000 acumulado → 5% → 250.
    expect(getTransactionCashback(tieredCard, txs[0], txs)).toBe(250);
    // La del ciclo actual: 12000 acumulado → 6% → 720.
    expect(getTransactionCashback(tieredCard, txs[1], txs)).toBe(720);
  });

  it('cada ciclo acumula por separado (no se mezclan al subir de nivel)', () => {
    // Dos transacciones, una por ciclo. Cada una sola en su ciclo → nivel 5%.
    const txs = [
      { cardId: 'card1', categoryId: 'ccn', amount: 6000, date: '2026-04-10' }, // ciclo mar–abr
      { cardId: 'card1', categoryId: 'ccn', amount: 6000, date: '2026-05-10' }, // ciclo abr–may
    ];
    expect(getTransactionCashback(tieredCard, txs[0], txs)).toBe(300); // 6000 * 5%
    expect(getTransactionCashback(tieredCard, txs[1], txs)).toBe(300); // 6000 * 5%
  });
});

describe('normalizeCashbackRules — preserva tiers al guardar', () => {
  it('conserva una regla escalonada (tiers) tal cual', () => {
    const tiers = [{ upTo: 7999, pct: 5 }, { upTo: Infinity, pct: 8 }];
    const out = normalizeCashbackRules([{ categoryId: 'ccn', tiers }]);
    expect(out).toEqual([{ categoryId: 'ccn', tiers }]);
  });
  it('conserva reglas planas con % > 0 y descarta % ≤ 0', () => {
    const out = normalizeCashbackRules([
      { categoryId: 'a', percentage: 5 },
      { categoryId: 'b', percentage: 0 },
      { categoryId: 'c', percentage: '3' },
    ]);
    expect(out).toEqual([
      { categoryId: 'a', percentage: 5 },
      { categoryId: 'c', percentage: 3 },
    ]);
  });
  it('descarta reglas sin categoryId', () => {
    expect(normalizeCashbackRules([{ percentage: 5 }, { tiers: [{ upTo: 1, pct: 2 }] }])).toEqual([]);
  });
  it('mezcla tiers y planas en la misma tarjeta', () => {
    const tiers = [{ upTo: 100, pct: 5 }];
    const out = normalizeCashbackRules([
      { categoryId: 'ccn', tiers },
      { categoryId: 'all', percentage: 1 },
    ]);
    expect(out).toEqual([{ categoryId: 'ccn', tiers }, { categoryId: 'all', percentage: 1 }]);
  });
  it('entrada no-array → []', () => {
    expect(normalizeCashbackRules(null)).toEqual([]);
    expect(normalizeCashbackRules(undefined)).toEqual([]);
  });
});

describe('computeCashback ignora reglas escalonadas', () => {
  const card = {
    cashbackRules: [
      { categoryId: 'ccn', tiers: [{ upTo: 7999, pct: 5 }, { upTo: Infinity, pct: 8 }] },
      { categoryId: 'all', percentage: 1 },
    ],
  };
  it('una compra CCN no congela cashback (lo maneja el camino derivado) → cae a all 1%', () => {
    // Sin el fix, encontraría la regla 'ccn' (tiers, sin percentage) y devolvería 0/NaN.
    // Con el fix, salta la regla escalonada y usa 'all' (1%): 1000 * 1% = 10.
    expect(computeCashback(card, 'ccn', 1000)).toBe(10);
  });
});

describe('getCardOutstanding', () => {
  const ref = new Date(2026, 4, 28); // corte 20 / pago 5 → ciclo abierto: 21-may a 20-jun
  const card = { id: 'c1', cutoffDay: 20, dueDay: 5, payments: [] };

  it('con ciclo válido coincide con getCardBalances().totalBalance (facturado + ciclo abierto)', () => {
    const txs = [
      { cardId: 'c1', date: '2026-05-10', amount: 3000, cashbackEarned: 30 }, // facturado
      { cardId: 'c1', date: '2026-05-25', amount: 1200, cashbackEarned: 0 },  // ciclo abierto
    ];
    const withPayment = { ...card, openingBalance: 500, payments: [{ id: 'p1', amount: 1000 }] };
    for (const c of [card, withPayment]) {
      expect(getCardOutstanding(c, txs, ref).owed).toBe(getCardBalances(c, txs, ref).totalBalance);
    }
    expect(getCardOutstanding(card, txs, ref)).toEqual({ owed: 4170, hasValidCycle: true });
  });

  it('el ciclo abierto suma al saldo aunque el facturado pendiente sea 0', () => {
    const txs = [{ cardId: 'c1', date: '2026-05-25', amount: 2000, cashbackEarned: 0 }];
    expect(getCardBalances(card, txs, ref).pendingBilled).toBe(0);
    expect(getCardOutstanding(card, txs, ref).owed).toBe(2000);
  });

  it('un sobrepago deja el saldo en 0, nunca negativo', () => {
    const txs = [{ cardId: 'c1', date: '2026-05-10', amount: 5000, cashbackEarned: 0 }];
    const overpaid = { ...card, payments: [{ id: 'p1', amount: 8000 }] };
    expect(getCardOutstanding(overpaid, txs, ref).owed).toBe(0);
  });
});

describe('hasValidCardCycle', () => {
  it('días de corte y pago enteros entre 1 y 31 → válido', () => {
    expect(hasValidCardCycle({ cutoffDay: 20, dueDay: 5 })).toBe(true);
    expect(hasValidCardCycle({ cutoffDay: 1, dueDay: 31 })).toBe(true);
    expect(hasValidCardCycle({ cutoffDay: '20', dueDay: '5' })).toBe(true); // misma conversión que getCardCycles
  });

  it('corte o pago ausente, 0, NaN, fuera de rango o con decimales → inválido', () => {
    expect(hasValidCardCycle({ cutoffDay: NaN, dueDay: 5 })).toBe(false);
    expect(hasValidCardCycle({ cutoffDay: 0, dueDay: 5 })).toBe(false);
    expect(hasValidCardCycle({ cutoffDay: 20 })).toBe(false);
    expect(hasValidCardCycle({ cutoffDay: 20, dueDay: null })).toBe(false);
    expect(hasValidCardCycle({ cutoffDay: 32, dueDay: 5 })).toBe(false);
    expect(hasValidCardCycle({ cutoffDay: 20, dueDay: 4.5 })).toBe(false);
    expect(hasValidCardCycle({})).toBe(false);
    expect(hasValidCardCycle(null)).toBe(false);
  });
});

describe('getCardOutstanding · tarjeta sin ciclo válido', () => {
  const ref = new Date(2026, 4, 28);
  const noCycle = (extra = {}) => ({ id: 'c1', cutoffDay: NaN, dueDay: 5, payments: [], ...extra });
  const spend = (amount, date, cashbackEarned = 0) => ({ cardId: 'c1', date, amount, cashbackEarned });

  it('regresión: con corte NaN getCardBalances ignora el consumo, pero el saldo pendiente no', () => {
    const txs = [spend(5000, '2026-05-10')];
    expect(getCardBalances(noCycle(), txs, ref).totalBalance).toBe(0); // el problema que corrige
    expect(getCardOutstanding(noCycle(), txs, ref)).toEqual({ owed: 5000, hasValidCycle: false });
  });

  it('con corte 0 el ciclo es inválido aunque Date lo "arregle" al último día del mes anterior', () => {
    const card = noCycle({ cutoffDay: 0 });
    expect(getCardOutstanding(card, [spend(5000, '2026-05-10')], ref)).toEqual({ owed: 5000, hasValidCycle: false });
    // Un consumo futuro solo lo contaría la lectura por ciclo: aquí no entra.
    expect(getCardOutstanding(card, [spend(5000, '2026-06-02')], ref).owed).toBe(0);
  });

  it('también sin día de pago: se resta todo el consumo hasta hoy', () => {
    const card = { id: 'c1', cutoffDay: 20, payments: [] };
    expect(getCardOutstanding(card, [spend(3000, '2026-05-10')], ref)).toEqual({ owed: 3000, hasValidCycle: false });
  });

  it('suma saldo inicial y consumo neto de cashback; resta abonos', () => {
    const card = noCycle({ openingBalance: 2000, payments: [{ id: 'p1', amount: 1500 }] });
    const txs = [spend(10000, '2026-05-10', 100), spend(500, '2026-05-28')];
    // 2000 + (10000 − 100) + 500 − 1500
    expect(getCardOutstanding(card, txs, ref).owed).toBe(10900);
  });

  it('los consumos con fecha posterior a hoy no cuentan', () => {
    const txs = [spend(4000, '2026-05-28'), spend(9999, '2026-05-29')];
    expect(getCardOutstanding(noCycle(), txs, ref).owed).toBe(4000);
  });

  it('descuenta los estados de cuenta legados pagados (paidCycles con monto)', () => {
    const card = noCycle({ paidCycles: [{ cycleEnd: '2026-04-20', amount: 1200, cashback: 0 }] });
    expect(getCardOutstanding(card, [spend(5000, '2026-05-10')], ref).owed).toBe(3800);
  });

  it('un sobrepago deja el saldo en 0', () => {
    const card = noCycle({ payments: [{ id: 'p1', amount: 9000 }] });
    expect(getCardOutstanding(card, [spend(5000, '2026-05-10')], ref).owed).toBe(0);
  });

  it('ignora las transacciones de otras tarjetas', () => {
    const txs = [spend(5000, '2026-05-10'), { cardId: 'otra', date: '2026-05-10', amount: 777, cashbackEarned: 0 }];
    expect(getCardOutstanding(noCycle(), txs, ref).owed).toBe(5000);
  });
});
