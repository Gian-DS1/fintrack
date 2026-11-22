import { describe, it, expect } from 'vitest';
import {
  expandRecurring, getNextCardPayment, getCashflowUntilCardDue,
  getAverageMonthlySpend, monthlyEquivalent, projectRealMoney,
} from './cashflowProjection';

// Fechas fijas: nunca `new Date()` dentro de un test.
// Tarjeta con corte 20 / pago 5. A 28-may el estado cerrado va del 21-abr al 20-may
// y vence el 5-jun; el ciclo abierto va del 21-may al 20-jun.
const REF = new Date(2026, 4, 28);

const card = (id, extra = {}) => ({ id, name: `Tarjeta ${id}`, cutoffDay: 20, dueDay: 5, payments: [], ...extra });
const cardTx = (cardId, amount, date) =>
  ({ categoryId: 'c1', amount, type: 'variable_expense', cashbackEarned: 0, cardId, date });
const rec = (id, extra = {}) => ({
  id, type: 'income', amount: 1000, description: `Recurrente ${id}`, frequency: 'monthly',
  nextDate: '2026-06-01', active: true, cardId: null, ...extra,
});

const run = (over = {}) => getCashflowUntilCardDue({
  transactions: [], initialCashBalance: 0, cards: [], recurring: [], debts: [], debtPayments: [],
  currency: 'DOP', refDate: REF, ...over,
});

describe('expandRecurring', () => {
  it('semanal a 20 días → 3 ocurrencias (día 0, 7 y 14)', () => {
    const t = rec('r', { frequency: 'weekly', nextDate: '2026-05-28' });
    expect(expandRecurring(t, '2026-05-28', '2026-06-17'))
      .toEqual(['2026-05-28', '2026-06-04', '2026-06-11']);
  });

  it('quincenal avanza de 14 en 14 días', () => {
    const t = rec('r', { frequency: 'biweekly', nextDate: '2026-05-30' });
    expect(expandRecurring(t, '2026-05-28', '2026-06-30')).toEqual(['2026-05-30', '2026-06-13', '2026-06-27']);
  });

  it('plantilla inactiva → ninguna ocurrencia', () => {
    expect(expandRecurring(rec('r', { active: false }), '2026-05-28', '2026-07-30')).toEqual([]);
  });

  it('ignora las ocurrencias anteriores a `fromISO`', () => {
    const t = rec('r', { frequency: 'weekly', nextDate: '2026-05-10' });
    expect(expandRecurring(t, '2026-05-28', '2026-06-05')).toEqual(['2026-05-31']);
  });

  it('incluye los dos extremos del rango', () => {
    const t = rec('r', { frequency: 'monthly', nextDate: '2026-06-05' });
    expect(expandRecurring(t, '2026-06-05', '2026-06-05')).toEqual(['2026-06-05']);
  });

  it('mensual del día 31 cae en el último día de febrero', () => {
    const t = rec('r', { frequency: 'monthly', nextDate: '2027-01-31' });
    expect(expandRecurring(t, '2027-01-31', '2027-02-28')).toEqual(['2027-01-31', '2027-02-28']);
  });

  it('sin nextDate válida → ninguna ocurrencia', () => {
    expect(expandRecurring(rec('r', { nextDate: null }), '2026-05-28', '2026-07-30')).toEqual([]);
  });
});

describe('getNextCardPayment', () => {
  it('estado cerrado sin pagar → fecha de pago del estado y pendingBilled', () => {
    const p = getNextCardPayment(card('a'), [cardTx('a', 55000, '2026-05-10')], [], REF);
    expect(p).toEqual({ dateISO: '2026-06-05', amount: 55000, overdue: false });
  });

  it('estado vencido sin pagar → pago hoy con overdue', () => {
    const p = getNextCardPayment(card('a'), [cardTx('a', 55000, '2026-05-10')], [], new Date(2026, 5, 10));
    expect(p).toEqual({ dateISO: '2026-06-10', amount: 55000, overdue: true });
  });

  it('pago el mismo día del vencimiento → no es vencido', () => {
    const p = getNextCardPayment(card('a'), [cardTx('a', 55000, '2026-05-10')], [], new Date(2026, 5, 5));
    expect(p).toEqual({ dateISO: '2026-06-05', amount: 55000, overdue: false });
  });

  it('estado ya pagado → siguiente pago por el ciclo abierto, tras el próximo corte', () => {
    const c = card('a', { payments: [{ id: 'p1', amount: 55000, date: '2026-05-25' }] });
    const txs = [cardTx('a', 55000, '2026-05-10'), cardTx('a', 3000, '2026-05-25')];
    expect(getNextCardPayment(c, txs, [], REF)).toEqual({ dateISO: '2026-07-05', amount: 3000, overdue: false });
  });

  it('un ingreso o un ahorro con cardId huérfano no engorda el pago', () => {
    const txs = [
      cardTx('a', 55000, '2026-05-10'),
      { ...cardTx('a', 9000, '2026-05-10'), type: 'income' },
      { ...cardTx('a', 4000, '2026-05-10'), type: 'savings' },
    ];
    expect(getNextCardPayment(card('a'), txs, [], REF))
      .toEqual({ dateISO: '2026-06-05', amount: 55000, overdue: false });
  });

  it('un ingreso con cardId huérfano no crea un pago de tarjeta', () => {
    const txs = [{ ...cardTx('a', 9000, '2026-05-10'), type: 'income' }];
    expect(getNextCardPayment(card('a'), txs, [], REF)).toBeNull();
  });

  it('tarjeta sin nada que pagar → null', () => {
    expect(getNextCardPayment(card('a'), [], [], REF)).toBeNull();
  });

  it('tarjeta sin ciclo válido → null (no hay fecha de pago)', () => {
    const c = card('a', { cutoffDay: 0 });
    expect(getNextCardPayment(c, [cardTx('a', 5000, '2026-05-10')], [], REF)).toBeNull();
  });
});

describe('getCashflowUntilCardDue · recurrentes y pago de una tarjeta', () => {
  const base = (incomeAmount) => ({
    initialCashBalance: 40000,
    cards: [card('a')],
    transactions: [cardTx('a', 55000, '2026-05-10')],
    recurring: [rec('sueldo', { amount: incomeAmount, nextDate: '2026-06-01' })],
  });

  it('el ingreso cubre el pago → sin faltante y efectivo final 15,000', () => {
    const r = run(base(30000));
    expect(r.startCash).toBe(40000);
    expect(r.horizonISO).toBe('2026-06-05');
    expect(r.events.map((e) => [e.dateISO, e.kind, e.amount, e.balanceAfter])).toEqual([
      ['2026-06-01', 'income', 30000, 70000],
      ['2026-06-05', 'card_payment', -55000, 15000],
    ]);
    expect(r.endCash).toBe(15000);
    expect(r.minCash).toBe(15000);
    expect(r.firstShortfall).toBeNull();
  });

  it('el ingreso no alcanza → faltante 5,000 y efectivo final −5,000', () => {
    const r = run(base(10000));
    expect(r.endCash).toBe(-5000);
    expect(r.minCash).toBe(-5000);
    expect(r.firstShortfall).toMatchObject({ kind: 'card_payment', sourceId: 'a', shortfall: 5000, dateISO: '2026-06-05' });
    expect(r.events[1].shortfall).toBe(5000);
    expect(r.events[0].shortfall).toBe(0);
  });

  it('el efectivo de partida incluye ingresos, gastos sin tarjeta y abonos ya hechos', () => {
    // 40,000 + ingreso 5,000 − gasto en efectivo 1,000 − abono a la tarjeta 3,000 = 41,000.
    // El consumo con tarjeta no mueve el efectivo.
    const r = run({
      ...base(30000),
      cards: [card('a', { payments: [{ id: 'p1', amount: 3000, date: '2026-05-25' }] })],
      transactions: [
        cardTx('a', 55000, '2026-05-10'),
        { type: 'income', amount: 5000, categoryId: 'c1', date: '2026-05-01' },
        { type: 'variable_expense', amount: 1000, categoryId: 'c1', cashbackEarned: 0, date: '2026-05-02' },
      ],
    });
    expect(r.startCash).toBe(41000);
  });

  it('gasto recurrente sin tarjeta resta efectivo; ahorro recurrente también', () => {
    const r = run({
      initialCashBalance: 100000,
      recurring: [
        rec('alquiler', { type: 'fixed_expense', amount: 20000, nextDate: '2026-06-02' }),
        rec('meta', { type: 'savings', amount: 5000, nextDate: '2026-06-03' }),
      ],
    });
    expect(r.events.map((e) => [e.kind, e.amount, e.balanceAfter])).toEqual([
      ['recurring_expense', -20000, 80000],
      ['savings', -5000, 75000],
    ]);
    expect(r.horizonISO).toBe('2026-06-27'); // sin tarjetas con saldo: 30 días
  });

  it('recurrente inactivo no aparece', () => {
    const r = run({ recurring: [rec('x', { active: false })] });
    expect(r.events).toEqual([]);
  });

  it('ocurrencias anteriores a hoy se ignoran (materializeDue ya las convirtió)', () => {
    const r = run({ recurring: [rec('x', { nextDate: '2026-05-20', frequency: 'monthly' })] });
    expect(r.events.map((e) => e.dateISO)).toEqual(['2026-06-20']);
  });

  it('mismo día: ingreso → gasto recurrente → pago de tarjeta', () => {
    const r = run({
      initialCashBalance: 100000,
      cards: [card('a')],
      transactions: [cardTx('a', 55000, '2026-05-10')],
      recurring: [
        rec('gasto', { type: 'variable_expense', amount: 1000, nextDate: '2026-06-05' }),
        rec('sueldo', { type: 'income', amount: 2000, nextDate: '2026-06-05' }),
      ],
    });
    expect(r.events.map((e) => e.kind)).toEqual(['income', 'recurring_expense', 'card_payment']);
  });

  it('el pago de la tarjeta se evalúa con todo lo demás del día ya aplicado', () => {
    // 50,000 + ingreso 10,000 del mismo día alcanzan para 55,000.
    const r = run({
      initialCashBalance: 50000,
      cards: [card('a')],
      transactions: [cardTx('a', 55000, '2026-05-10')],
      recurring: [rec('sueldo', { amount: 10000, nextDate: '2026-06-05' })],
    });
    expect(r.firstShortfall).toBeNull();
    expect(r.endCash).toBe(5000);
  });

  it('sin eventos: efectivo final = efectivo de hoy', () => {
    const r = run({ initialCashBalance: 1234 });
    expect(r).toMatchObject({ startCash: 1234, endCash: 1234, minCash: 1234, events: [], firstShortfall: null, skippedDebts: [] });
  });

  it('pago vencido → evento hoy con overdue', () => {
    const r = run({
      refDate: new Date(2026, 5, 10),
      initialCashBalance: 100000,
      cards: [card('a')],
      transactions: [cardTx('a', 55000, '2026-05-10')],
    });
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ dateISO: '2026-06-10', kind: 'card_payment', overdue: true, amount: -55000 });
  });

  it('el mínimo de efectivo considera los saldos intermedios', () => {
    const r = run({
      initialCashBalance: 10000,
      recurring: [
        rec('gasto', { type: 'fixed_expense', amount: 15000, nextDate: '2026-06-01' }),
        rec('sueldo', { type: 'income', amount: 20000, nextDate: '2026-06-10' }),
      ],
    });
    expect(r.minCash).toBe(-5000);
    expect(r.endCash).toBe(15000);
  });
});

describe('getCashflowUntilCardDue · préstamos y moneda', () => {
  // Un préstamo vence el día 3 de cada mes. Con la tarjeta de siempre el horizonte
  // llega al 5-jun, así que la cuota del 3-jun cabe y la del 3-jul no.
  const debt = (id, extra = {}) => ({
    id, creditorName: `Préstamo ${id}`, currentBalance: 100000, monthlyPayment: 5000,
    due_date: '2026-05-03', status: 'active', currency: 'DOP', ...extra,
  });
  const withCard = {
    initialCashBalance: 100000,
    cards: [card('a')],
    transactions: [cardTx('a', 20000, '2026-05-10')],
  };

  it('incluye la cuota que cae antes del pago de la tarjeta', () => {
    const r = run({ ...withCard, debts: [debt('d1')] });
    expect(r.events.map((e) => [e.dateISO, e.kind, e.label, e.amount, e.sourceId])).toEqual([
      ['2026-06-03', 'loan', 'Préstamo d1', -5000, 'd1'],
      ['2026-06-05', 'card_payment', 'Tarjeta a', -20000, 'a'],
    ]);
    expect(r.endCash).toBe(75000);
  });

  it('cuota del ciclo actual ya pagada → pasa a la del mes siguiente solo si cabe en el horizonte', () => {
    const paid = [{ debtId: 'd1', amount: 5000, date: '2026-05-20' }];
    // Hoy 28-may: la cuota vigente es la del 3-jun, y ya está pagada → la siguiente es el 3-jul.
    const fuera = run({ ...withCard, debts: [debt('d1')], debtPayments: paid });
    expect(fuera.events.map((e) => e.kind)).toEqual(['card_payment']);

    // Con un pago de tarjeta lejano (ciclo abierto, 5-jul) el horizonte sí llega al 3-jul.
    const lejano = run({
      initialCashBalance: 100000,
      cards: [card('a', { payments: [{ id: 'p', amount: 20000, date: '2026-05-25' }] })],
      transactions: [cardTx('a', 20000, '2026-05-10'), cardTx('a', 3000, '2026-05-25')],
      debts: [debt('d1')],
      debtPayments: paid,
    });
    expect(lejano.events.map((e) => [e.dateISO, e.kind])).toEqual([
      ['2026-07-03', 'loan'],
      ['2026-07-05', 'card_payment'],
    ]);
  });

  it('cuota con día de ancla 31: el mes siguiente conserva el día 31', () => {
    const r = run({
      initialCashBalance: 100000,
      cards: [card('a', { payments: [{ id: 'p', amount: 20000, date: '2026-05-25' }] })],
      transactions: [cardTx('a', 20000, '2026-05-10'), cardTx('a', 3000, '2026-05-25')],
      debts: [debt('d1', { due_date: '2026-01-31' })],
    });
    expect(r.events.filter((e) => e.kind === 'loan').map((e) => e.dateISO)).toEqual(['2026-05-31', '2026-06-30']);
  });

  it('día de ancla 31 con la cuota de abril ya pagada: no cuenta dos cuotas en mayo', () => {
    // Hoy 20-abr-2027. La cuota vigente (30-abr) se pagó el 10-abr, así que
    // getNextLoanDueDate salta al 30-may. La tarjeta (ya pagada) paga el 3-jun y
    // alarga el horizonte: antes salían el 30 y el 31 de mayo.
    const r = run({
      refDate: new Date(2027, 3, 20),
      initialCashBalance: 100000,
      cards: [card('a', { cutoffDay: 20, dueDay: 3, payments: [{ id: 'p', amount: 10000, date: '2027-04-10' }] })],
      transactions: [cardTx('a', 10000, '2027-04-01'), cardTx('a', 2000, '2027-04-21')],
      debts: [debt('d1', { due_date: '2027-01-31' })],
      debtPayments: [{ debtId: 'd1', amount: 5000, date: '2027-04-10' }],
    });
    expect(r.horizonISO).toBe('2027-06-03');
    const cuotas = r.events.filter((e) => e.kind === 'loan').map((e) => e.dateISO);
    expect(cuotas).toEqual(['2027-05-30']);
  });

  it('con saldo igual a una cuota solo cuenta una cuota dentro del horizonte', () => {
    const r = run({
      initialCashBalance: 100000,
      cards: [card('a', { payments: [{ id: 'p', amount: 20000, date: '2026-05-25' }] })],
      transactions: [cardTx('a', 20000, '2026-05-10'), cardTx('a', 3000, '2026-05-25')],
      debts: [debt('d1', { currentBalance: 1000, monthlyPayment: 1000 })],
    });
    expect(r.horizonISO).toBe('2026-07-05');
    expect(r.events.filter((e) => e.kind === 'loan').map((e) => [e.dateISO, e.amount])).toEqual([['2026-06-03', -1000]]);
  });

  it('la última cuota se reduce al saldo que queda', () => {
    const r = run({
      initialCashBalance: 100000,
      cards: [card('a', { payments: [{ id: 'p', amount: 20000, date: '2026-05-25' }] })],
      transactions: [cardTx('a', 20000, '2026-05-10'), cardTx('a', 3000, '2026-05-25')],
      debts: [debt('d1', { currentBalance: 1500, monthlyPayment: 1000 })],
    });
    expect(r.events.filter((e) => e.kind === 'loan').map((e) => [e.dateISO, e.amount])).toEqual([
      ['2026-06-03', -1000],
      ['2026-07-03', -500],
    ]);
  });

  it('préstamo saldado, sin fecha o con cuota 0 → no aparece', () => {
    const r = run({
      ...withCard,
      debts: [
        debt('pagado', { status: 'paid_off' }),
        debt('sinfecha', { due_date: null }),
        debt('cuota0', { monthlyPayment: 0 }),
        debt('sinsaldo', { currentBalance: 0 }),
      ],
    });
    expect(r.events.map((e) => e.kind)).toEqual(['card_payment']);
    expect(r.skippedDebts).toEqual([]);
  });

  it('préstamo en otra moneda → excluido y listado en skippedDebts', () => {
    const r = run({ ...withCard, debts: [debt('usd', { currency: 'USD' }), debt('d1')] });
    expect(r.events.map((e) => e.sourceId)).toEqual(['d1', 'a']);
    expect(r.skippedDebts).toEqual(['usd']);
  });

  it('un préstamo en otra moneda ya saldado no se avisa como omitido', () => {
    const r = run({ ...withCard, debts: [debt('usd', { currency: 'USD', status: 'paid_off' })] });
    expect(r.skippedDebts).toEqual([]);
  });

  it('mismo día: la cuota va después del ingreso y antes del gasto recurrente', () => {
    const r = run({
      ...withCard,
      debts: [debt('d1', { due_date: '2026-06-02' })],
      recurring: [
        rec('gasto', { type: 'fixed_expense', amount: 100, nextDate: '2026-06-02' }),
        rec('sueldo', { type: 'income', amount: 200, nextDate: '2026-06-02' }),
      ],
    });
    expect(r.events.filter((e) => e.dateISO === '2026-06-02').map((e) => e.kind)).toEqual(['income', 'loan', 'recurring_expense']);
  });
});

describe('getCashflowUntilCardDue · varias tarjetas y recurrentes con tarjeta', () => {
  // A 2-may: la tarjeta A (corte 20 / pago 5) paga el 5-may; la B (corte 1 / pago 26) el 26-may.
  const REF2 = new Date(2026, 4, 2);
  const cardB = (extra = {}) => card('b', { cutoffDay: 1, dueDay: 26, ...extra });
  const dos = {
    refDate: REF2,
    initialCashBalance: 100000,
    cards: [card('a'), cardB()],
    transactions: [cardTx('a', 10000, '2026-04-10'), cardTx('b', 20000, '2026-04-10')],
  };

  it('dos tarjetas con pagos el 5 y el 26 → horizonte el 26 y un pago por tarjeta', () => {
    const r = run(dos);
    expect(r.horizonISO).toBe('2026-05-26');
    expect(r.events.map((e) => [e.dateISO, e.kind, e.sourceId, e.amount])).toEqual([
      ['2026-05-05', 'card_payment', 'a', -10000],
      ['2026-05-26', 'card_payment', 'b', -20000],
    ]);
    expect(r.endCash).toBe(70000);
  });

  it('el faltante es el del primer pago que no se cubre', () => {
    const r = run({ ...dos, initialCashBalance: 15000 });
    // A se paga con 15,000 (quedan 5,000); B pide 20,000 → faltan 15,000.
    expect(r.firstShortfall).toMatchObject({ sourceId: 'b', shortfall: 15000, dateISO: '2026-05-26' });
  });

  it('el horizonte nunca pasa de 45 días y el pago más lejano queda fuera', () => {
    // Ambas ya pagadas. Sus próximos pagos: A el 5-jun (ciclo abierto, corte 20-may)
    // y B el 26-jun (corte 1-jun). Hoy 2-may + 45 días = 16-jun.
    const r = run({
      refDate: REF2,
      initialCashBalance: 100000,
      cards: [
        card('a', { payments: [{ id: 'p', amount: 10000, date: '2026-04-25' }] }),
        cardB({ payments: [{ id: 'p', amount: 10000, date: '2026-04-25' }] }),
      ],
      transactions: [
        cardTx('a', 10000, '2026-04-10'), cardTx('a', 2000, '2026-04-25'),
        cardTx('b', 10000, '2026-04-10'), cardTx('b', 3000, '2026-05-02'),
      ],
    });
    expect(r.horizonISO).toBe('2026-06-16');
    expect(r.events.map((e) => [e.dateISO, e.sourceId, e.amount])).toEqual([['2026-06-05', 'a', -2000]]);
  });

  it('sin tarjetas con saldo → horizonte de 30 días', () => {
    expect(run({ refDate: REF2 }).horizonISO).toBe('2026-06-01');
    expect(run({ refDate: REF2, cards: [card('a')] }).horizonISO).toBe('2026-06-01');
  });

  describe('recurrente con tarjeta', () => {
    // Tarjeta ya pagada: su próximo pago es el 5-jul por el ciclo abierto (corte 20-jun).
    const pagada = {
      initialCashBalance: 100000,
      cards: [card('a', { payments: [{ id: 'p', amount: 55000, date: '2026-05-25' }] })],
      transactions: [cardTx('a', 55000, '2026-05-10'), cardTx('a', 3000, '2026-05-25')],
    };
    const conTarjeta = (nextDate) => rec('netflix', { type: 'fixed_expense', amount: 1500, cardId: 'a', nextDate });

    it('antes del corte: no cambia el efectivo y suma 1,500 al pago de esa tarjeta', () => {
      const sin = run(pagada);
      const con = run({ ...pagada, recurring: [conTarjeta('2026-06-10')] });
      expect(con.events.map((e) => e.kind)).toEqual(['card_payment']);
      expect(con.events[0].amount).toBe(sin.events[0].amount - 1500);
      expect(con.startCash).toBe(sin.startCash);
    });

    it('semanal con tarjeta: suma cada ocurrencia previa al corte', () => {
      const semanal = rec('gym', { type: 'fixed_expense', amount: 500, cardId: 'a', frequency: 'weekly', nextDate: '2026-06-01' });
      const r = run({ ...pagada, recurring: [semanal] });
      // 1, 8, 15 de junio (el 22 ya es del ciclo siguiente) → 3 cargos de 500.
      expect(r.events[0].amount).toBe(-(3000 + 1500));
    });

    it('después del corte: no afecta a ese pago', () => {
      const sin = run(pagada);
      const con = run({ ...pagada, recurring: [conTarjeta('2026-06-25')] });
      expect(con.events[0].amount).toBe(sin.events[0].amount);
    });

    it('de otra tarjeta: no afecta a este pago', () => {
      const sin = run(pagada);
      const con = run({ ...pagada, recurring: [{ ...conTarjeta('2026-06-10'), cardId: 'zzz' }] });
      expect(con.events[0].amount).toBe(sin.events[0].amount);
    });

    it('si el estado cerrado sigue sin pagar, el cargo cae en el ciclo abierto y no afecta ese pago', () => {
      const sinPagar = {
        initialCashBalance: 100000,
        cards: [card('a')],
        transactions: [cardTx('a', 55000, '2026-05-10')],
        recurring: [conTarjeta('2026-06-02')],
      };
      const r = run(sinPagar);
      expect(r.events.map((e) => [e.kind, e.amount])).toEqual([['card_payment', -55000]]);
    });

    it('una tarjeta sin consumo pero con recurrente previo al corte sí genera pago', () => {
      const r = run({
        initialCashBalance: 100000,
        cards: [card('a')],
        transactions: [],
        recurring: [conTarjeta('2026-06-10')],
      });
      expect(r.events.map((e) => [e.dateISO, e.kind, e.amount])).toEqual([['2026-07-05', 'card_payment', -1500]]);
    });
  });

  it('cuenta los pagos de tarjeta que quedan fuera del horizonte de 45 días', () => {
    // Mismo caso del tope: el pago de B (26-jun) cae después del 16-jun.
    const r = run({
      refDate: REF2,
      initialCashBalance: 100000,
      cards: [
        card('a', { payments: [{ id: 'p', amount: 10000, date: '2026-04-25' }] }),
        cardB({ payments: [{ id: 'p', amount: 10000, date: '2026-04-25' }] }),
      ],
      transactions: [
        cardTx('a', 10000, '2026-04-10'), cardTx('a', 2000, '2026-04-25'),
        cardTx('b', 10000, '2026-04-10'), cardTx('b', 3000, '2026-05-02'),
      ],
    });
    expect(r.paymentsBeyondHorizon).toBe(1);
  });

  it('sin pagos fuera del horizonte → paymentsBeyondHorizon es 0', () => {
    expect(run(dos).paymentsBeyondHorizon).toBe(0);
    expect(run({ refDate: REF2 }).paymentsBeyondHorizon).toBe(0);
  });

  it('tarjeta sin ciclo válido → no genera pago previsto', () => {
    const r = run({
      initialCashBalance: 100000,
      cards: [card('a', { cutoffDay: null, dueDay: null })],
      transactions: [cardTx('a', 5000, '2026-05-10')],
    });
    expect(r.events).toEqual([]);
    expect(r.horizonISO).toBe('2026-06-27');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Entrega 3 · promedio mensual de gasto (ticket 09)
// A 28-may-2026 los meses completos más recientes son feb, mar y abr.
// ─────────────────────────────────────────────────────────────────────────────
const spend = (type, amount, date, extra = {}) =>
  ({ categoryId: 'c1', amount, type, cashbackEarned: 0, cardId: null, date, ...extra });

describe('getAverageMonthlySpend', () => {
  it('sin transacciones → promedio 0 y 0 meses', () => {
    expect(getAverageMonthlySpend([], REF)).toEqual({ average: 0, monthsUsed: 0 });
  });

  it('el primer dato cae en el mes en curso → 0 meses completos', () => {
    const txs = [spend('variable_expense', 9000, '2026-05-03')];
    expect(getAverageMonthlySpend(txs, REF)).toEqual({ average: 0, monthsUsed: 0 });
  });

  it('1 mes completo disponible (abril)', () => {
    const txs = [spend('variable_expense', 3000, '2026-04-01')];
    expect(getAverageMonthlySpend(txs, REF)).toEqual({ average: 3000, monthsUsed: 1 });
  });

  it('2 meses completos disponibles (marzo y abril)', () => {
    const txs = [
      spend('variable_expense', 2000, '2026-03-01'),
      spend('variable_expense', 4000, '2026-04-10'),
    ];
    expect(getAverageMonthlySpend(txs, REF)).toEqual({ average: 3000, monthsUsed: 2 });
  });

  it('3 meses completos → promedio de feb, mar y abr', () => {
    const txs = [
      spend('variable_expense', 3000, '2026-02-01'),
      spend('variable_expense', 6000, '2026-03-10'),
      spend('variable_expense', 9000, '2026-04-10'),
    ];
    expect(getAverageMonthlySpend(txs, REF)).toEqual({ average: 6000, monthsUsed: 3 });
  });

  it('con más de 3 meses de historial usa solo los 3 más recientes', () => {
    const txs = [
      spend('variable_expense', 90000, '2026-01-10'),
      spend('variable_expense', 3000, '2026-02-10'),
      spend('variable_expense', 3000, '2026-03-10'),
      spend('variable_expense', 3000, '2026-04-10'),
    ];
    expect(getAverageMonthlySpend(txs, REF)).toEqual({ average: 3000, monthsUsed: 3 });
  });

  it('ignora el mes en curso', () => {
    const txs = [
      spend('variable_expense', 3000, '2026-04-01'),
      spend('variable_expense', 99000, '2026-05-02'),
    ];
    expect(getAverageMonthlySpend(txs, REF)).toEqual({ average: 3000, monthsUsed: 1 });
  });

  it('ignora los meses previos al primer dato (no cuentan como meses en cero)', () => {
    const txs = [
      spend('variable_expense', 2000, '2026-03-01'),
      spend('variable_expense', 4000, '2026-04-10'),
    ];
    // Febrero es anterior al primer dato: monthsUsed es 2, no 3.
    expect(getAverageMonthlySpend(txs, REF).monthsUsed).toBe(2);
  });

  it('un mes con datos de otro tipo pero sin gasto variable cuenta como 0', () => {
    const txs = [
      { ...spend('income', 50000, '2026-02-01') },
      spend('variable_expense', 3000, '2026-04-10'),
    ];
    expect(getAverageMonthlySpend(txs, REF)).toEqual({ average: 1000, monthsUsed: 3 });
  });

  it('es neto de cashback', () => {
    const txs = [spend('variable_expense', 1000, '2026-04-01', { cashbackEarned: 10, cardId: 'a' })];
    expect(getAverageMonthlySpend(txs, REF).average).toBe(990);
  });

  it('cuenta los gastos con y sin tarjeta', () => {
    const txs = [
      spend('variable_expense', 1000, '2026-04-01', { cardId: 'a' }),
      spend('variable_expense', 500, '2026-04-06'),
    ];
    expect(getAverageMonthlySpend(txs, REF).average).toBe(1500);
  });

  it('por defecto cuenta variable y gasto legado, no fijos, ingresos ni ahorro', () => {
    const txs = [
      spend('variable_expense', 1000, '2026-04-05'),
      spend('expense', 200, '2026-04-06'),
      spend('fixed_expense', 5000, '2026-04-07'),
      spend('income', 80000, '2026-04-01'),
      spend('savings', 4000, '2026-04-08'),
    ];
    expect(getAverageMonthlySpend(txs, REF).average).toBe(1200);
  });

  it('`types` permite promediar los gastos fijos', () => {
    const txs = [
      spend('variable_expense', 1000, '2026-04-01'),
      spend('fixed_expense', 5000, '2026-04-07'),
    ];
    expect(getAverageMonthlySpend(txs, REF, { types: ['fixed_expense'] }).average).toBe(5000);
  });

  it('`categoryIds` filtra por categoría', () => {
    const txs = [
      spend('variable_expense', 1000, '2026-04-01', { categoryId: 'food' }),
      spend('variable_expense', 700, '2026-04-06', { categoryId: 'fun' }),
    ];
    expect(getAverageMonthlySpend(txs, REF, { categoryIds: ['food'] })).toEqual({ average: 1000, monthsUsed: 1 });
  });

  it('`categoryIds` vacío → ninguna categoría: promedio 0 con los mismos meses', () => {
    const txs = [spend('variable_expense', 1000, '2026-04-05', { categoryId: 'food' })];
    expect(getAverageMonthlySpend(txs, REF, { categoryIds: [] })).toEqual({ average: 0, monthsUsed: 1 });
  });

  it('`months` limita la ventana', () => {
    const txs = [
      spend('variable_expense', 9000, '2026-03-10'),
      spend('variable_expense', 3000, '2026-04-10'),
    ];
    expect(getAverageMonthlySpend(txs, REF, { months: 1 })).toEqual({ average: 3000, monthsUsed: 1 });
  });

  it('cruza el año: en enero los meses completos son nov, dic y el anterior', () => {
    const ref = new Date(2027, 0, 15);
    const txs = [
      spend('variable_expense', 3000, '2026-11-01'),
      spend('variable_expense', 6000, '2026-12-10'),
    ];
    expect(getAverageMonthlySpend(txs, ref)).toEqual({ average: 4500, monthsUsed: 2 });
  });
});

describe('monthlyEquivalent', () => {
  it('mensual × 1', () => {
    expect(monthlyEquivalent({ amount: 2000, frequency: 'monthly' })).toBe(2000);
  });

  it('semanal × 52/12', () => {
    expect(monthlyEquivalent({ amount: 600, frequency: 'weekly' })).toBeCloseTo(2600, 5);
  });

  it('quincenal × 26/12', () => {
    expect(monthlyEquivalent({ amount: 1200, frequency: 'biweekly' })).toBeCloseTo(2600, 5);
  });

  it('frecuencia desconocida se trata como mensual y un monto inválido como 0', () => {
    expect(monthlyEquivalent({ amount: 500, frequency: 'otra' })).toBe(500);
    expect(monthlyEquivalent({ amount: 'x', frequency: 'monthly' })).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Entrega 3 · proyección del dinero real a 12 meses (tickets 10, 11 y 12)
// REF = 28-may-2026: el mes en curso queda con 4 días (28 al 31) de 31.
// Hay 13 puntos: cierre de mayo (parcial) y los 12 meses siguientes.
// ─────────────────────────────────────────────────────────────────────────────
const THIS_MONTH_SHARE = 4 / 31;
const dRec = (id, extra = {}) => rec(id, { type: 'fixed_expense', ...extra });
const loan = (id, extra = {}) => ({
  id, creditorName: `Préstamo ${id}`, status: 'active', currency: 'DOP', due_date: '2026-06-10',
  monthlyPayment: 1000, currentBalance: 3000, ...extra,
});
const monthlyHistory = (type, amount, categoryId = 'c1') =>
  ['2026-02-01', '2026-03-01', '2026-04-01'].map((date) => spend(type, amount, date, { categoryId }));

const proj = (over = {}) => projectRealMoney({
  transactions: [], initialCashBalance: 0, cards: [], recurring: [], debts: [], debtPayments: [],
  currency: 'DOP', refDate: REF, ...over,
});
const deltas = (r) => r.points.slice(1).map((p, i) => p.realMoney - r.points[i].realMoney);

describe('projectRealMoney · escenario «como vas»', () => {
  it('sin recurrentes, préstamos ni historial: curva plana en el dinero real de hoy', () => {
    const r = proj({ initialCashBalance: 40000 });
    expect(r.start).toBe(40000);
    expect(r.points).toHaveLength(13);
    expect(r.points.every((p) => p.realMoney === 40000)).toBe(true);
    expect(r.firstNegativeKey).toBeNull();
  });

  it('las claves van de mayo-2026 a mayo-2027 y cruzan el año', () => {
    const r = proj();
    expect(r.points[0]).toMatchObject({ key: '2026-05', y: 2026, m: 4 });
    expect(r.points[8]).toMatchObject({ key: '2027-01', y: 2027, m: 0 });
    expect(r.points[12].key).toBe('2027-05');
  });

  it('el punto de partida es el dinero real de hoy (efectivo − saldo de tarjetas)', () => {
    const r = proj({
      initialCashBalance: 40000, cards: [card('a')],
      transactions: [cardTx('a', 55000, '2026-05-10')],
    });
    expect(r.start).toBe(-15000);
    expect(r.points[0].realMoney).toBe(-15000);
    expect(r.firstNegativeKey).toBe('2026-05');
  });

  it('ingreso recurrente 50,000 y variable base 30,000 → sube 20,000 por mes completo', () => {
    const r = proj({
      recurring: [rec('s', { amount: 50000, nextDate: '2026-06-01' })],
      transactions: monthlyHistory('variable_expense', 30000),
    });
    expect(r.base.variable).toBe(30000);
    expect(r.base.variableMonthsUsed).toBe(3);
    deltas(r).forEach((d) => expect(d).toBeCloseTo(20000, 2));
  });

  it('el mes en curso prorratea el gasto variable por los días que quedan (hoy incluido)', () => {
    const r = proj({ transactions: monthlyHistory('variable_expense', 30000) });
    // Las transacciones históricas (sin tarjeta) ya bajaron el efectivo de hoy.
    expect(r.points[0].variableOut).toBeCloseTo(30000 * THIS_MONTH_SHARE, 2);
    expect(r.points[1].variableOut).toBe(30000);
  });

  it('el mes en curso solo cuenta las ocurrencias recurrentes desde hoy', () => {
    const r = proj({
      recurring: [
        rec('hoy', { amount: 100, nextDate: '2026-05-28' }),
        rec('pasada', { amount: 700, nextDate: '2026-05-10' }),
        rec('luego', { amount: 10, nextDate: '2026-05-31' }),
      ],
    });
    expect(r.points[0].income).toBe(110);
  });

  it('una plantilla semanal cuenta cada ocurrencia del mes', () => {
    const r = proj({ recurring: [rec('w', { amount: 1000, frequency: 'weekly', nextDate: '2026-06-03' })] });
    // Junio 2026: 3, 10, 17 y 24 → 4. Julio: 1, 8, 15, 22 y 29 → 5.
    expect(r.points[1].income).toBe(4000);
    expect(r.points[2].income).toBe(5000);
  });

  it('los gastos recurrentes restan con y sin tarjeta, y también los ahorros recurrentes', () => {
    const r = proj({
      recurring: [
        rec('a', { type: 'variable_expense', amount: 300, nextDate: '2026-06-05' }),
        rec('b', { type: 'fixed_expense', amount: 200, nextDate: '2026-06-05', cardId: 'a' }),
        rec('c', { type: 'savings', amount: 100, nextDate: '2026-06-05' }),
      ],
    });
    expect(r.points[1].recurringOut).toBe(600);
    expect(r.points[1].realMoney).toBe(-600);
  });

  it('ignora las plantillas inactivas', () => {
    const r = proj({ recurring: [rec('x', { active: false, amount: 5000, nextDate: '2026-06-05' })] });
    expect(r.points[1].income).toBe(0);
  });

  it('préstamo con 3 cuotas restantes → resta solo en 3 meses', () => {
    const r = proj({ debts: [loan('p')] });
    expect(r.points.map((p) => p.loanOut)).toEqual([0, 1000, 1000, 1000, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(r.points[12].realMoney).toBe(-3000);
  });

  it('la última cuota se reduce al saldo que queda (2,500 con cuota de 1,000)', () => {
    const r = proj({ debts: [loan('p', { currentBalance: 2500 })] });
    expect(r.points.slice(1, 5).map((p) => p.loanOut)).toEqual([1000, 1000, 500, 0]);
  });

  it('una cuota que vence este mes después de hoy entra en el mes en curso', () => {
    const r = proj({ debts: [loan('p', { due_date: '2026-05-30', currentBalance: 1000 })] });
    expect(r.points[0].loanOut).toBe(1000);
    expect(r.points[1].loanOut).toBe(0);
  });

  it('un préstamo del día 31 no se arrastra al 28 después de febrero', () => {
    const r = proj({ debts: [loan('p', { due_date: '2026-01-31', currentBalance: 12000 })] });
    // Mayo (31) ya cuenta como cuota del mes en curso; luego una por mes.
    expect(r.points.slice(0, 12).every((p) => p.loanOut === 1000)).toBe(true);
  });

  it('omite los préstamos de otra moneda y los lista en skippedDebts', () => {
    const r = proj({ debts: [loan('usd', { currency: 'USD' }), loan('dop')] });
    expect(r.skippedDebts).toEqual(['usd']);
    expect(r.points[1].loanOut).toBe(1000);
  });

  it('ignora los préstamos saldados o sin cuota', () => {
    const r = proj({ debts: [loan('a', { status: 'paid_off' }), loan('b', { monthlyPayment: 0 })] });
    expect(r.points.every((p) => p.loanOut === 0)).toBe(true);
  });

  it('firstNegativeKey es el primer mes con dinero real < 0 y minPoint el más bajo', () => {
    const r = proj({
      initialCashBalance: 2500,
      recurring: [rec('e', { type: 'fixed_expense', amount: 1000, nextDate: '2026-06-05' })],
    });
    // 2,500 → 1,500 (jun) → 500 (jul) → −500 (ago)
    expect(r.firstNegativeKey).toBe('2026-08');
    expect(r.minPoint.key).toBe('2027-05');
    expect(r.minPoint.realMoney).toBe(-9500);
  });

  it('fijos no programados: promedio de fijos menos el equivalente de los recurrentes fijos', () => {
    const r = proj({
      transactions: monthlyHistory('fixed_expense', 10000),
      recurring: [dRec('alq', { amount: 4000, nextDate: '2026-06-02' })],
    });
    expect(r.base.fixedUnscheduled).toBe(6000);
    expect(r.points[1].fixedOut).toBe(6000);
  });

  it('fijos no programados nunca es negativo', () => {
    const r = proj({
      transactions: monthlyHistory('fixed_expense', 1000),
      recurring: [dRec('alq', { amount: 4000, nextDate: '2026-06-02' })],
    });
    expect(r.base.fixedUnscheduled).toBe(0);
  });

  it('fijos no programados también se prorratean en el mes en curso', () => {
    const r = proj({ transactions: monthlyHistory('fixed_expense', 10000) });
    expect(r.points[0].fixedOut).toBeCloseTo(10000 * THIS_MONTH_SHARE, 2);
  });

  it('hasRecurringIncome avisa si no hay ingresos recurrentes activos', () => {
    expect(proj().hasRecurringIncome).toBe(false);
    expect(proj({ recurring: [rec('x', { active: false })] }).hasRecurringIncome).toBe(false);
    expect(proj({ recurring: [rec('x')] }).hasRecurringIncome).toBe(true);
  });

  it('no modifica los datos de entrada', () => {
    const input = {
      transactions: monthlyHistory('variable_expense', 30000),
      recurring: [rec('s')], debts: [loan('p')], cards: [card('a')],
    };
    const before = JSON.stringify(input);
    proj(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('projectRealMoney · escenarios «solo lo esencial» y «con recortes»', () => {
  const history = [
    ...monthlyHistory('variable_expense', 20000, 'food'),
    ...monthlyHistory('variable_expense', 10000, 'fun'),
  ];

  it('«con recortes» al 20 % con base 30,000 → resta 24,000 por mes', () => {
    const r = proj({ transactions: history, scenario: 'cuts', cutPct: 0.2 });
    expect(r.base.variable).toBe(24000);
    expect(r.points[1].variableOut).toBe(24000);
  });

  it('base.average conserva el promedio automático en cualquier escenario', () => {
    for (const scenario of ['current', 'essential', 'cuts']) {
      const r = proj({ transactions: history, scenario, variableOverride: 5, essentialCategoryIds: ['food'] });
      expect(r.base.average).toBe(30000);
    }
  });

  it('«con recortes» usa 20 % por defecto', () => {
    expect(proj({ transactions: history, scenario: 'cuts' }).base.variable).toBe(24000);
  });

  it('«con recortes» respeta otro porcentaje', () => {
    expect(proj({ transactions: history, scenario: 'cuts', cutPct: 0.5 }).base.variable).toBe(15000);
  });

  it('«solo lo esencial» sin categorías marcadas → gasto variable 0', () => {
    const r = proj({ transactions: history, scenario: 'essential', essentialCategoryIds: [] });
    expect(r.base.variable).toBe(0);
    expect(r.points[1].variableOut).toBe(0);
  });

  it('«solo lo esencial» promedia solo las categorías marcadas', () => {
    const r = proj({ transactions: history, scenario: 'essential', essentialCategoryIds: ['food'] });
    expect(r.base.variable).toBe(20000);
    expect(r.base.variableMonthsUsed).toBe(3);
  });

  it('los escenarios no cambian ingresos, recurrentes, préstamos ni fijos no programados', () => {
    const common = {
      transactions: [...history, ...monthlyHistory('fixed_expense', 5000)],
      recurring: [rec('s', { amount: 50000, nextDate: '2026-06-01' })], debts: [loan('p')],
    };
    const a = proj({ ...common, scenario: 'current' });
    const b = proj({ ...common, scenario: 'cuts' });
    expect(b.points.map((p) => [p.income, p.recurringOut, p.loanOut, p.fixedOut]))
      .toEqual(a.points.map((p) => [p.income, p.recurringOut, p.loanOut, p.fixedOut]));
  });
});

describe('projectRealMoney · cancelaciones simuladas y corrección manual', () => {
  const gym = rec('gym', { type: 'variable_expense', amount: 2000, nextDate: '2026-06-05' });

  it('apagar un recurrente de 2,000/mes sube el último punto en 24,000', () => {
    const base = proj({ recurring: [gym] });
    const off = proj({ recurring: [gym], excludedRecurringIds: ['gym'] });
    expect(off.points[12].realMoney - base.points[12].realMoney).toBe(24000);
  });

  it('suma además la ocurrencia del mes en curso si cae después de hoy', () => {
    const late = { ...gym, nextDate: '2026-05-30' };
    const base = proj({ recurring: [late] });
    const off = proj({ recurring: [late], excludedRecurringIds: ['gym'] });
    expect(off.points[12].realMoney - base.points[12].realMoney).toBe(26000);
  });

  it('la cancelación aplica en todos los escenarios', () => {
    const history = monthlyHistory('variable_expense', 30000);
    for (const scenario of ['current', 'essential', 'cuts']) {
      const base = proj({ recurring: [gym], transactions: history, scenario });
      const off = proj({ recurring: [gym], transactions: history, scenario, excludedRecurringIds: ['gym'] });
      expect(off.points[12].realMoney - base.points[12].realMoney).toBe(24000);
    }
  });

  it('apagar un recurrente fijo no hace crecer los fijos no programados', () => {
    const rent = dRec('rent', { amount: 4000, nextDate: '2026-06-02' });
    const common = { transactions: monthlyHistory('fixed_expense', 10000), recurring: [rent] };
    const off = proj({ ...common, excludedRecurringIds: ['rent'] });
    expect(off.base.fixedUnscheduled).toBe(6000);
    expect(off.points[12].realMoney - proj(common).points[12].realMoney).toBe(48000);
  });

  it('también se puede apagar un ingreso recurrente (parche para ingresos restringidos)', () => {
    const bonus = rec('bono', { amount: 1500, nextDate: '2026-06-05' });
    const off = proj({ recurring: [bonus], excludedRecurringIds: ['bono'] });
    expect(off.points.every((p) => p.income === 0)).toBe(true);
  });

  it('`variableOverride` reemplaza el promedio en «como vas» y en «con recortes»', () => {
    const history = monthlyHistory('variable_expense', 30000);
    expect(proj({ transactions: history, variableOverride: 10000 }).base.variable).toBe(10000);
    expect(proj({ transactions: history, variableOverride: 10000, scenario: 'cuts', cutPct: 0.5 }).base.variable).toBe(5000);
  });

  it('`variableOverride` en 0 es un valor válido (no se confunde con «sin corrección»)', () => {
    const history = monthlyHistory('variable_expense', 30000);
    expect(proj({ transactions: history, variableOverride: 0 }).base.variable).toBe(0);
  });

  it('`variableOverride` no afecta a «solo lo esencial»', () => {
    const history = monthlyHistory('variable_expense', 30000, 'food');
    const r = proj({ transactions: history, variableOverride: 1, scenario: 'essential', essentialCategoryIds: ['food'] });
    expect(r.base.variable).toBe(30000);
  });

  it('sin historial y con corrección manual la proyección usa el valor manual', () => {
    const r = proj({ variableOverride: 5000 });
    expect(r.base.variableMonthsUsed).toBe(0);
    expect(r.points[1].variableOut).toBe(5000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regresiones de la revisión de la entrega 3
// ─────────────────────────────────────────────────────────────────────────────
describe('projectRealMoney · pagos de préstamo ya hechos (B1)', () => {
  // addPayment del store de deudas crea una transacción fixed_expense con categoría
  // `pago-deuda`. Esas cuotas ya salieron del efectivo y la proyección vuelve a
  // restar las que faltan: no pueden contarse además como «fijos no programados».
  const paidTxs = ['2026-02-01', '2026-03-01', '2026-04-01'].map((date, i) =>
    spend('fixed_expense', 10000, date, { id: `loan-tx-${i}`, categoryId: 'pago-deuda' }));
  const linkedPayments = paidTxs.map((t, i) => ({ id: `pay-${i}`, debtId: 'p', amount: 10000, date: t.date, transactionId: t.id }));
  const oldPayments = paidTxs.map((t, i) => ({ id: `pay-${i}`, debtId: 'p', amount: 10000, date: t.date, transactionId: null }));
  const common = { transactions: paidTxs, initialCashBalance: 100000, debts: [loan('p', { monthlyPayment: 10000, currentBalance: 30000 })] };

  it('con el pago enlazado a su transacción, no hay fijos no programados y la curva se aplana al terminar el préstamo', () => {
    const r = proj({ ...common, debtPayments: linkedPayments });
    expect(r.start).toBe(70000);
    expect(r.base.fixedUnscheduled).toBe(0);
    expect(r.points.map((p) => p.loanOut)).toEqual([0, 10000, 10000, 10000, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(r.points.every((p) => p.fixedOut === 0)).toBe(true);
    // Solo las 3 cuotas que faltan: 70,000 − 30,000, y plana desde entonces.
    expect(r.points.slice(3).every((p) => p.realMoney === 40000)).toBe(true);
    expect(r.points[12].realMoney).toBe(40000);
  });

  it('pagos antiguos sin enlace: se excluyen por la categoría que se pasa por parámetro', () => {
    const r = proj({ ...common, debtPayments: oldPayments, debtPaymentCategoryIds: ['pago-deuda'] });
    expect(r.base.fixedUnscheduled).toBe(0);
    expect(r.points[12].realMoney).toBe(40000);
  });

  it('sin enlace ni categoría no se puede saber qué es: no se excluye nada (la función no asume la categoría)', () => {
    const r = proj({ ...common, debtPayments: oldPayments });
    expect(r.base.fixedUnscheduled).toBe(10000);
  });

  it('un fijo de otra categoría (no la de deudas) sigue contando', () => {
    const rent = spend('fixed_expense', 4000, '2026-04-01', { id: 'rent-tx', categoryId: 'alquiler' });
    const r = proj({ ...common, transactions: [...paidTxs, rent], debtPayments: linkedPayments });
    expect(r.base.fixedUnscheduled).toBeCloseTo(4000 / 3, 2);
  });
});

describe('getAverageMonthlySpend · exclusiones', () => {
  it('`excludeTransactionIds` y `excludeCategoryIds` quedan fuera del promedio', () => {
    const txs = [
      spend('fixed_expense', 1000, '2026-04-01', { id: 'a', categoryId: 'x' }),
      spend('fixed_expense', 500, '2026-04-02', { id: 'b', categoryId: 'y' }),
      spend('fixed_expense', 300, '2026-04-03', { id: 'c', categoryId: 'z' }),
    ];
    const opts = { types: ['fixed_expense'], excludeTransactionIds: ['a'], excludeCategoryIds: ['y'] };
    expect(getAverageMonthlySpend(txs, REF, opts).average).toBe(300);
  });
});

describe('projectRealMoney · variable recurrente ya materializado (I1)', () => {
  // Un recurrente de gasto variable se materializa como transacciones, así que ya
  // está dentro del promedio: se netea igual que los fijos, para no contarlo dos veces.
  const netflix = rec('nf', { type: 'variable_expense', amount: 600, nextDate: '2026-06-05' });
  const history = monthlyHistory('variable_expense', 600);

  it('el recurrente variable y su historial se cuentan una sola vez', () => {
    const r = proj({ transactions: history, recurring: [netflix] });
    expect(r.base.average).toBe(600);
    expect(r.base.variableScheduled).toBe(600);
    expect(r.base.variable).toBe(0);
    expect(r.points[1].recurringOut).toBe(600);
    expect(r.points[1].variableOut).toBe(0);
  });

  it('apagarlo quita de verdad sus 600 al mes (no queda como gasto variable)', () => {
    const on = proj({ transactions: history, recurring: [netflix] });
    const off = proj({ transactions: history, recurring: [netflix], excludedRecurringIds: ['nf'] });
    expect(off.points[1].recurringOut).toBe(0);
    expect(off.points[1].variableOut).toBe(0);
    expect(off.points[12].realMoney - on.points[12].realMoney).toBe(600 * 12);
  });

  it('también netea los gastos legados (`expense`)', () => {
    const legacy = rec('old', { type: 'expense', amount: 600, nextDate: '2026-06-05' });
    expect(proj({ transactions: history, recurring: [legacy] }).base.variable).toBe(0);
  });

  it('no baja de 0 cuando el recurrente pesa más que el promedio', () => {
    const r = proj({ transactions: monthlyHistory('variable_expense', 100), recurring: [netflix] });
    expect(r.base.variable).toBe(0);
  });

  it('un recurrente variable inactivo no se netea', () => {
    const r = proj({ transactions: history, recurring: [{ ...netflix, active: false }] });
    expect(r.base.variable).toBe(600);
    expect(r.base.variableScheduled).toBe(0);
  });

  it('«con recortes» recorta solo lo no programado', () => {
    const gym = rec('gym', { type: 'variable_expense', amount: 2000, nextDate: '2026-06-05' });
    const r = proj({ transactions: monthlyHistory('variable_expense', 30000), recurring: [gym], scenario: 'cuts', cutPct: 0.2 });
    expect(r.base.variable).toBe(22400);
  });

  it('la corrección manual reemplaza el valor no programado', () => {
    const r = proj({ transactions: history, recurring: [netflix], variableOverride: 1500 });
    expect(r.base.variable).toBe(1500);
    expect(r.base.variableScheduled).toBe(600);
  });

  it('«solo lo esencial» netea solo los recurrentes de las categorías esenciales', () => {
    const txs = [...monthlyHistory('variable_expense', 600, 'food'), ...monthlyHistory('variable_expense', 400, 'fun')];
    const recurringFood = rec('f', { type: 'variable_expense', amount: 200, categoryId: 'food', nextDate: '2026-06-05' });
    const recurringFun = rec('u', { type: 'variable_expense', amount: 400, categoryId: 'fun', nextDate: '2026-06-05' });
    const common = { transactions: txs, recurring: [recurringFood, recurringFun], scenario: 'essential' };
    expect(proj({ ...common, essentialCategoryIds: ['food'] }).base.variable).toBe(400);
    expect(proj({ ...common, essentialCategoryIds: ['fun'] }).base.variable).toBe(0);
    expect(proj({ ...common, essentialCategoryIds: [] }).base.variable).toBe(0);
  });
});

describe('getAverageMonthlySpend · primer mes parcial (I3)', () => {
  const NOV_REF = new Date(2026, 10, 22);

  it('el único mes es parcial: se prorratea por los días con datos (22-oct a 31-oct = 10 de 31)', () => {
    const txs = [spend('variable_expense', 3000, '2026-10-22')];
    const r = getAverageMonthlySpend(txs, NOV_REF);
    expect(r.monthsUsed).toBe(1);
    expect(r.average).toBeCloseTo(3000 * 31 / 10, 2);
  });

  it('con menos de 10 días de datos no se extrapola: 0 meses para que la pantalla pida el valor a mano', () => {
    expect(getAverageMonthlySpend([spend('variable_expense', 3000, '2026-10-23')], NOV_REF)).toEqual({ average: 0, monthsUsed: 0 });
    expect(getAverageMonthlySpend([spend('variable_expense', 3000, '2026-10-31')], NOV_REF)).toEqual({ average: 0, monthsUsed: 0 });
  });

  it('`prorateFirstMonth: false` usa el mes parcial tal cual, sin extrapolar ni mínimo de días', () => {
    const txs = [spend('fixed_expense', 32000, '2026-10-31')];
    const r = getAverageMonthlySpend(txs, NOV_REF, { types: ['fixed_expense'], prorateFirstMonth: false });
    expect(r).toEqual({ average: 32000, monthsUsed: 1 });
  });

  it('el único mes completo-disponible empieza el 10: 21 de 30 días', () => {
    const txs = [spend('variable_expense', 3000, '2026-04-10')];
    expect(getAverageMonthlySpend(txs, REF).average).toBeCloseTo(3000 * 30 / 21, 2);
  });

  it('si hay otro mes completo, el parcial no se usa', () => {
    const txs = [
      spend('variable_expense', 90000, '2026-03-15'),
      spend('variable_expense', 3000, '2026-04-01'),
    ];
    expect(getAverageMonthlySpend(txs, REF)).toEqual({ average: 3000, monthsUsed: 1 });
  });

  it('el primer dato puede ser de cualquier tipo: marca igualmente el mes parcial', () => {
    const txs = [
      spend('income', 50000, '2026-03-20'),
      spend('variable_expense', 90000, '2026-03-25'),
      spend('variable_expense', 3000, '2026-04-02'),
    ];
    expect(getAverageMonthlySpend(txs, REF)).toEqual({ average: 3000, monthsUsed: 1 });
  });

  it('un primer dato en día 1 es un mes completo', () => {
    const txs = [
      spend('variable_expense', 2000, '2026-03-01'),
      spend('variable_expense', 4000, '2026-04-01'),
    ];
    expect(getAverageMonthlySpend(txs, REF)).toEqual({ average: 3000, monthsUsed: 2 });
  });

  it('un primer dato anterior a la ventana no afecta: los 3 meses siguen completos', () => {
    const txs = [
      spend('variable_expense', 1, '2026-01-15'),
      spend('variable_expense', 3000, '2026-02-10'),
      spend('variable_expense', 3000, '2026-03-10'),
      spend('variable_expense', 3000, '2026-04-10'),
    ];
    expect(getAverageMonthlySpend(txs, REF)).toEqual({ average: 3000, monthsUsed: 3 });
  });
});

describe('projectRealMoney · fijos no programados a 0 (M2)', () => {
  const common = {
    transactions: monthlyHistory('fixed_expense', 10000),
    recurring: [dRec('alq', { amount: 4000, nextDate: '2026-06-02' })],
  };

  it('por defecto se incluyen', () => {
    expect(proj(common).points[1].fixedOut).toBe(6000);
  });

  it('con `includeFixedUnscheduled: false` no restan nada, pero el importe sigue visible en base', () => {
    const r = proj({ ...common, includeFixedUnscheduled: false });
    expect(r.base.fixedUnscheduled).toBe(6000);
    expect(r.points.every((p) => p.fixedOut === 0)).toBe(true);
    expect(r.points[12].realMoney - proj(common).points[12].realMoney).toBeCloseTo(6000 * 12 + 6000 * THIS_MONTH_SHARE, 2);
  });
});

describe('projectRealMoney · base.variableUnscheduled', () => {
  it('es el promedio menos lo programado, sin importar el escenario ni la corrección manual', () => {
    const gym = rec('gym', { type: 'variable_expense', amount: 2000, nextDate: '2026-06-05' });
    const txs = monthlyHistory('variable_expense', 30000);
    for (const scenario of ['current', 'essential', 'cuts']) {
      const r = proj({ transactions: txs, recurring: [gym], scenario, variableOverride: 5 });
      expect(r.base.variableScheduled).toBe(2000);
      expect(r.base.variableUnscheduled).toBe(28000);
    }
  });
});

describe('projectRealMoney · primer mes parcial y fijos (N1)', () => {
  const NOV = new Date(2026, 10, 22);
  // Empezó el 16-oct y pagó el alquiler el 20-oct: es un pago único, no se prorratea.
  const txs = [
    spend('income', 50000, '2026-10-16'),
    spend('fixed_expense', 32000, '2026-10-20', { id: 'rent', categoryId: 'alquiler' }),
  ];

  it('los fijos no programados no se inflan con el prorrateo del mes parcial', () => {
    const r = proj({ transactions: txs, refDate: NOV });
    expect(r.base.fixedUnscheduled).toBe(32000);
  });

  it('el gasto variable sí se prorratea en el mismo caso (16 de 31 días)', () => {
    const r = proj({
      transactions: [...txs, spend('variable_expense', 3000, '2026-10-17')], refDate: NOV,
    });
    expect(r.base.average).toBeCloseTo(3000 * 31 / 16, 2);
    expect(r.base.variableMonthsUsed).toBe(1);
  });

  it('con pocos días de datos el variable queda en 0 meses y no se dispara', () => {
    const r = proj({ transactions: [spend('variable_expense', 3000, '2026-10-31')], refDate: NOV });
    expect(r.base.variableMonthsUsed).toBe(0);
    expect(r.base.average).toBe(0);
  });
});
