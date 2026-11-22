import { describe, it, expect } from 'vitest';
import { expandRecurring, getNextCardPayment, getCashflowUntilCardDue } from './cashflowProjection';

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
