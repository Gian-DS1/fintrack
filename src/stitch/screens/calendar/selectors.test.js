import { describe, it, expect } from 'vitest';
import { getDayMovements, getDueEvents, getMonthSummary, getUpcoming } from './selectors';

const tx = (date, amount, type = 'variable_expense', cashbackEarned = 0) => ({ date, amount, type, cashbackEarned, categoryId: 'c1', description: 'x' });

describe('getDayMovements', () => {
  it('vacío → {}', () => {
    expect(getDayMovements([], 2026, 5)).toEqual({});
  });
  it('agrupa por día, separa income/expense, resta cashback', () => {
    const m = getDayMovements([
      tx('2026-06-10', 1000, 'income'),
      tx('2026-06-10', 200, 'variable_expense', 20),
      tx('2026-05-10', 999, 'income'), // otro mes, se ignora
    ], 2026, 5);
    expect(m[10].income).toBe(1000);
    expect(m[10].expense).toBe(180); // 200-20
    expect(m[10].list).toHaveLength(2);
    expect(m[9]).toBeUndefined();
  });
});

describe('getDueEvents', () => {
  const now = new Date(2026, 5, 1);
  it('deuda con due_date en el mes → evento tipo deuda', () => {
    const debts = [{ creditorName: 'Banco', monthlyPayment: 5000, due_date: '2026-06-28', status: 'active', currency: 'DOP' }];
    const e = getDueEvents({ debts, cards: [], goals: [], recurring: [] }, 2026, 5, now, []);
    expect(e[28]).toBeTruthy();
    expect(e[28][0].type).toBe('deuda');
    expect(e[28][0].amount).toBe(5000);
  });
  it('meta con deadline en el mes y no completada → evento meta', () => {
    const goals = [{ title: 'Viaje', deadline: '2026-06-15', status: 'active' }];
    const e = getDueEvents({ debts: [], cards: [], goals, recurring: [] }, 2026, 5, now, []);
    expect(e[15][0].type).toBe('meta');
  });
  it('meta completada se ignora', () => {
    const goals = [{ title: 'Hecho', deadline: '2026-06-15', status: 'completed' }];
    const e = getDueEvents({ debts: [], cards: [], goals, recurring: [] }, 2026, 5, now, []);
    expect(e[15]).toBeUndefined();
  });
  it('recurrente con nextDate en el mes → evento recurrente', () => {
    const recurring = [{ description: 'Netflix', amount: 590, type: 'variable_expense', nextDate: '2026-06-05', active: true }];
    const e = getDueEvents({ debts: [], cards: [], goals: [], recurring }, 2026, 5, now, []);
    expect(e[5][0].type).toBe('recurrente');
  });
  it('deuda pagada en el ciclo no aparece en el mes actual sino que rueda al siguiente', () => {
    const debts = [{ id: 'd1', creditorName: 'Banco', monthlyPayment: 5000, due_date: '2026-06-28', status: 'active', currency: 'DOP' }];
    const debtPayments = [{ debtId: 'd1', amount: 5000, date: '2026-06-27' }];
    const eJunio = getDueEvents({ debts, cards: [], goals: [], recurring: [], debtPayments }, 2026, 5, now, []);
    expect(eJunio[28]).toBeUndefined();

    const eJulio = getDueEvents({ debts, cards: [], goals: [], recurring: [], debtPayments }, 2026, 6, now, []);
    expect(eJulio[28]).toBeTruthy();
    expect(eJulio[28][0].type).toBe('deuda');
  });
  it('eventos fuera del mes se ignoran', () => {
    const debts = [{ creditorName: 'X', monthlyPayment: 1, due_date: '2026-07-10', status: 'active' }];
    const e = getDueEvents({ debts, cards: [], goals: [], recurring: [] }, 2026, 5, now, []);
    expect(Object.keys(e)).toHaveLength(0);
  });
});

describe('getMonthSummary', () => {
  it('vacío → ceros', () => {
    expect(getMonthSummary([], 2026, 5)).toEqual({ income: 0, expense: 0, balance: 0 });
  });
  it('suma neta de cashback', () => {
    const s = getMonthSummary([tx('2026-06-01', 5000, 'income'), tx('2026-06-02', 1000, 'variable_expense', 100)], 2026, 5);
    expect(s.income).toBe(5000);
    expect(s.expense).toBe(900);
    expect(s.balance).toBe(4100);
  });
});

describe('getUpcoming', () => {
  const now = new Date(2026, 5, 10);
  it('ordena por fecha ascendente y rueda al próximo mes los pagos ya vencidos', () => {
    const debts = [
      { creditorName: 'A', monthlyPayment: 1, due_date: '2026-06-20', status: 'active' },
      { creditorName: 'B', monthlyPayment: 1, due_date: '2026-06-05', status: 'active' }, // ya pasó → rueda a jul 05
      { creditorName: 'C', monthlyPayment: 1, due_date: '2026-06-15', status: 'active' },
    ];
    const list = getUpcoming({ debts, cards: [], goals: [], recurring: [] }, now, [], 30);
    // C (jun 15) y A (jun 20) siguen este mes; B rodó a jul 05 y aparece al final.
    expect(list.map((x) => x.label)).toEqual(['C', 'A', 'B']);
    expect(list[0].daysUntil).toBe(5);
    expect(list.find((x) => x.label === 'B').date).toBe('2026-07-05');
  });
  it('respeta la ventana de N días', () => {
    const debts = [{ creditorName: 'Lejos', monthlyPayment: 1, due_date: '2026-08-01', status: 'active' }];
    const list = getUpcoming({ debts, cards: [], goals: [], recurring: [] }, now, [], 30);
    expect(list).toHaveLength(0);
  });
});
