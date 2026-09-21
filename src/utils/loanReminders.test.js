import { describe, it, expect } from 'vitest';
import { getDueLoanReminders, loanReminderKey } from './loanReminders';
import { DEFAULT_DAYS_BEFORE } from './cardReminders';

// Préstamo base: cuota del día 5, pago mensual 12 000, saldo 150 000. Con una
// fecha ancla de enero, la próxima ocurrencia en junio de 2026 es 2026-06-05.
const debt = {
  id: 'd1',
  creditorName: 'Banco Popular',
  monthlyPayment: 12000,
  currentBalance: 150000,
  due_date: '2026-01-05',
  status: 'active',
  currency: 'DOP',
};

// Días antes del 2026-06-05.
const dayBefore = (n) => new Date(2026, 5, 5 - n);

describe('getDueLoanReminders', () => {
  it('avisa 5 días antes de la fecha de pago', () => {
    const r = getDueLoanReminders([debt], dayBefore(5), DEFAULT_DAYS_BEFORE);
    expect(r).toHaveLength(1);
    expect(r[0].debtId).toBe('d1');
    expect(r[0].creditorName).toBe('Banco Popular');
    expect(r[0].amount).toBe(12000);
    expect(r[0].currentBalance).toBe(150000);
    expect(r[0].currency).toBe('DOP');
    expect(r[0].dueDateISO).toBe('2026-06-05');
    expect(r[0].days).toBe(5);
    expect(r[0].offsetKey).toBe(5);
    expect(r[0].isOverdue).toBe(false);
  });

  it('no avisa a 4 días si la configuración es [5, 1]', () => {
    expect(getDueLoanReminders([debt], dayBefore(4), [5, 1])).toHaveLength(0);
  });

  it('avisa 1 día antes', () => {
    const r = getDueLoanReminders([debt], dayBefore(1), [5, 1]);
    expect(r).toHaveLength(1);
    expect(r[0].days).toBe(1);
    expect(r[0].offsetKey).toBe(1);
  });

  it('avisa el mismo día del vencimiento aunque no esté en la configuración', () => {
    const r = getDueLoanReminders([debt], dayBefore(0), [5, 1]);
    expect(r).toHaveLength(1);
    expect(r[0].days).toBe(0);
    expect(r[0].isOverdue).toBe(false);
  });

  it('no genera avisos de mora: la fecha rueda al mes siguiente en vez de quedar vencida', () => {
    // Un día después del vencimiento, nextMonthlyOccurrence ya devuelve
    // 2026-07-05 (la ocurrencia futura), así que no hay nada vencido que avisar.
    expect(getDueLoanReminders([debt], dayBefore(-1), [5, 1])).toHaveLength(0);
  });

  it('no avisa un préstamo saldado (status paid_off)', () => {
    const pagado = { ...debt, status: 'paid_off' };
    expect(getDueLoanReminders([pagado], dayBefore(5), [5, 1])).toHaveLength(0);
  });

  it('no avisa un préstamo sin fecha de pago', () => {
    const sinFecha = { ...debt, due_date: null };
    expect(getDueLoanReminders([sinFecha], dayBefore(5), [5, 1])).toHaveLength(0);
  });

  it('no avisa un préstamo sin cuota mensual', () => {
    const sinCuota = { ...debt, monthlyPayment: 0 };
    expect(getDueLoanReminders([sinCuota], dayBefore(5), [5, 1])).toHaveLength(0);
  });

  it('no avisa un préstamo sin saldo pendiente', () => {
    const sinSaldo = { ...debt, currentBalance: 0 };
    expect(getDueLoanReminders([sinSaldo], dayBefore(5), [5, 1])).toHaveLength(0);
  });

  it('ignora préstamos sin id', () => {
    const sinId = { ...debt, id: undefined };
    expect(getDueLoanReminders([sinId], dayBefore(5), [5, 1])).toHaveLength(0);
  });

  it('no repite un aviso ya registrado en la bitácora', () => {
    const sent = new Set([loanReminderKey('d1', '2026-06-05', 5)]);
    expect(getDueLoanReminders([debt], dayBefore(5), [5, 1], sent)).toHaveLength(0);
    // Otra antelación del mismo ciclo sí debe salir.
    expect(getDueLoanReminders([debt], dayBefore(1), [5, 1], sent)).toHaveLength(1);
  });

  it('respeta la moneda propia del préstamo', () => {
    const enDolares = { ...debt, currency: 'USD' };
    const r = getDueLoanReminders([enDolares], dayBefore(5), [5, 1]);
    expect(r[0].currency).toBe('USD');
  });

  it('recorta el día 31 a la longitud del mes destino', () => {
    // Ancla el día 31; enero → feb(28) → mar(31) → abr(30, recortado). La
    // ocurrencia cae en 2026-04-30. Con refDate 2026-04-25 faltan 5 días.
    const finDeMes = { ...debt, due_date: '2026-01-31' };
    const r = getDueLoanReminders([finDeMes], new Date(2026, 3, 25), [5, 1]);
    expect(r).toHaveLength(1);
    expect(r[0].dueDateISO).toBe('2026-04-30');
    expect(r[0].days).toBe(5);
  });

  it('ordena varios préstamos por urgencia', () => {
    // Segundo préstamo con pago el día 1: en 2026-05-31 le faltaría 1 día, a
    // diferencia del préstamo base cuyo ciclo de junio vence el 5 (5 días).
    const debt2 = { ...debt, id: 'd2', creditorName: 'Banco BHD', due_date: '2026-01-01' };
    const r = getDueLoanReminders([debt, debt2], new Date(2026, 4, 31), [5, 1]);
    expect(r.map((x) => x.debtId)).toEqual(['d2', 'd1']);
    expect(r[0].days).toBe(1);
    expect(r[1].days).toBe(5);
  });

  it('cae a las antelaciones por defecto si la configuración viene vacía', () => {
    expect(getDueLoanReminders([debt], dayBefore(5), [])).toHaveLength(1);
  });
});
