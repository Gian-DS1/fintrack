import { describe, it, expect } from 'vitest';
import {
  getDueLoanReminders,
  loanReminderKey,
  getNextLoanDueDate,
  isLoanInstallmentPaid,
  getLoanPaymentsInWindow,
  previousLoanMonthlyOccurrence,
} from './loanReminders';
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

describe('getLoanPaymentsInWindow', () => {
  it('suma solo pagos dentro de la ventana (startISO, endISO]', () => {
    const list = [
      { debtId: 'd1', amount: 1000, date: '2026-08-26' }, // en el límite inferior (excluido)
      { debtId: 'd1', amount: 5000, date: '2026-09-10' }, // dentro
      { debtId: 'd1', amount: 7000, date: '2026-09-26' }, // en el límite superior (incluido)
      { debtId: 'd1', amount: 9000, date: '2026-09-27' }, // fuera (después)
      { debtId: 'd2', amount: 2000, date: '2026-09-15' }, // otra deuda
    ];
    const sum = getLoanPaymentsInWindow(list, 'd1', '2026-08-26', '2026-09-26');
    expect(sum).toBe(12000);
  });
});

describe('previousLoanMonthlyOccurrence', () => {
  it('obtiene la fecha del mes anterior respetando el día ancla', () => {
    expect(previousLoanMonthlyOccurrence('2026-09-26', '2026-09-26')).toBe('2026-08-26');
    expect(previousLoanMonthlyOccurrence('2026-01-26', '2026-01-26')).toBe('2025-12-26');
    expect(previousLoanMonthlyOccurrence('2026-01-31', '2026-03-31')).toBe('2026-02-28');
  });
});

describe('getNextLoanDueDate & isLoanInstallmentPaid', () => {
  it('devuelve la fecha del mes si no hay pagos', () => {
    const next = getNextLoanDueDate(debt, [], new Date(2026, 5, 5));
    expect(next).toBe('2026-06-05');
  });

  it('avanza al mes siguiente si la cuota ya fue pagada el día anterior (caso del usuario)', () => {
    // Vence el 26 de septiembre. El usuario pagó el 25 de septiembre.
    const prestamoBHD = {
      id: 'bhd',
      creditorName: 'Prestamo BHD',
      monthlyPayment: 15877.23,
      currentBalance: 403554.13,
      due_date: '2026-09-26',
      status: 'active',
    };
    const payments = [
      { debtId: 'bhd', amount: 15877.23, date: '2026-09-25' },
    ];
    // Hoy es 26 de septiembre de 2026
    const today = new Date(2026, 8, 26);
    expect(isLoanInstallmentPaid(prestamoBHD, payments, '2026-09-26')).toBe(true);
    expect(getNextLoanDueDate(prestamoBHD, payments, today)).toBe('2026-10-26');
  });

  it('avanza al mes siguiente si la cuota se paga el mismo día de vencimiento', () => {
    const prestamo = { ...debt, due_date: '2026-06-05' };
    const payments = [{ debtId: 'd1', amount: 12000, date: '2026-06-05' }];
    expect(getNextLoanDueDate(prestamo, payments, new Date(2026, 5, 5))).toBe('2026-07-05');
  });

  it('no avanza si el pago fue parcial (menor a la cuota)', () => {
    const prestamo = { ...debt, due_date: '2026-06-05' };
    const payments = [{ debtId: 'd1', amount: 5000, date: '2026-06-04' }];
    expect(isLoanInstallmentPaid(prestamo, payments, '2026-06-05')).toBe(false);
    expect(getNextLoanDueDate(prestamo, payments, new Date(2026, 5, 5))).toBe('2026-06-05');
  });

  it('avanza si varios pagos parciales suman la cuota', () => {
    const prestamo = { ...debt, due_date: '2026-06-05' };
    const payments = [
      { debtId: 'd1', amount: 6000, date: '2026-05-20' },
      { debtId: 'd1', amount: 6000, date: '2026-06-02' },
    ];
    expect(isLoanInstallmentPaid(prestamo, payments, '2026-06-05')).toBe(true);
    expect(getNextLoanDueDate(prestamo, payments, new Date(2026, 5, 5))).toBe('2026-07-05');
  });

  it('devuelve null si el préstamo ya no tiene saldo o está saldado', () => {
    expect(getNextLoanDueDate({ ...debt, status: 'paid_off' }, [])).toBeNull();
    expect(getNextLoanDueDate({ ...debt, currentBalance: 0 }, [])).toBeNull();
  });
});

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

  it('avisa el mismo día del vencimiento si NO se ha pagado', () => {
    const r = getDueLoanReminders([debt], dayBefore(0), [5, 1]);
    expect(r).toHaveLength(1);
    expect(r[0].days).toBe(0);
    expect(r[0].isOverdue).toBe(false);
  });

  it('NO avisa hoy si la cuota ya fue pagada ayer (problema reportado por el usuario)', () => {
    const prestamoBHD = {
      id: 'bhd',
      creditorName: 'Prestamo BHD',
      monthlyPayment: 15877.23,
      currentBalance: 403554.13,
      due_date: '2026-09-26',
      status: 'active',
      currency: 'DOP',
    };
    const payments = [
      { debtId: 'bhd', amount: 15877.23, date: '2026-09-25' },
    ];
    // Hoy es 26 de septiembre a las 6:34 am
    const today = new Date(2026, 8, 26, 6, 34);
    const reminders = getDueLoanReminders([prestamoBHD], payments, today, [5, 1]);
    // NO debe enviar ningún correo hoy porque ya se pagó ayer y la próxima cuota es el 26 de octubre (en 30 días)
    expect(reminders).toHaveLength(0);
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
