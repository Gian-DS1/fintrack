import { describe, it, expect } from 'vitest';
import {
  getDueReminders, todayInZone, resolveOffsetKey, reminderKey,
  DEFAULT_DAYS_BEFORE, OVERDUE_MAX_DAYS,
} from './cardReminders';

// Tarjeta base: corte 20, pago 5 del mes siguiente. Con un consumo del 10 de
// mayo (dentro del ciclo cerrado 21-abr → 20-may) vence el 2026-06-05.
const card = { id: 'c1', name: 'Visa Popular', bank: 'Banco Popular', cutoffDay: 20, dueDay: 5, payments: [] };
const txs = [{ cardId: 'c1', date: '2026-05-10', amount: 5000, cashbackEarned: 0 }];

// Días antes del 2026-06-05.
const dayBefore = (n) => new Date(2026, 5, 5 - n);

describe('resolveOffsetKey', () => {
  it('avisa solo en las antelaciones configuradas', () => {
    expect(resolveOffsetKey(5, [5, 1])).toBe(5);
    expect(resolveOffsetKey(1, [5, 1])).toBe(1);
    expect(resolveOffsetKey(4, [5, 1])).toBeNull();
  });

  it('avisa siempre el mismo día del vencimiento', () => {
    expect(resolveOffsetKey(0, [5, 1])).toBe(0);
  });

  it('avisa a diario durante la mora y deja de insistir después del tope', () => {
    expect(resolveOffsetKey(-1, [5, 1])).toBe(-1);
    expect(resolveOffsetKey(-OVERDUE_MAX_DAYS, [5, 1])).toBe(-OVERDUE_MAX_DAYS);
    expect(resolveOffsetKey(-OVERDUE_MAX_DAYS - 1, [5, 1])).toBeNull();
  });
});

describe('getDueReminders', () => {
  it('avisa 5 días antes de la fecha de pago', () => {
    const r = getDueReminders([card], txs, dayBefore(5), DEFAULT_DAYS_BEFORE);
    expect(r).toHaveLength(1);
    expect(r[0].cardName).toBe('Visa Popular');
    expect(r[0].bank).toBe('Banco Popular');
    expect(r[0].amount).toBe(5000);
    expect(r[0].dueDateISO).toBe('2026-06-05');
    expect(r[0].days).toBe(5);
    expect(r[0].offsetKey).toBe(5);
    expect(r[0].isOverdue).toBe(false);
  });

  it('incluye el período del estado de cuenta', () => {
    const r = getDueReminders([card], txs, dayBefore(5), DEFAULT_DAYS_BEFORE);
    expect(r[0].statementStartISO).toBe('2026-04-21');
    expect(r[0].statementEndISO).toBe('2026-05-20');
  });

  it('no avisa a 4 días si la configuración es [5, 1]', () => {
    expect(getDueReminders([card], txs, dayBefore(4), [5, 1])).toHaveLength(0);
  });

  it('avisa el mismo día del vencimiento aunque no esté en la configuración', () => {
    const r = getDueReminders([card], txs, dayBefore(0), [5, 1]);
    expect(r).toHaveLength(1);
    expect(r[0].days).toBe(0);
    expect(r[0].isOverdue).toBe(false);
  });

  it('avisa una tarjeta vencida hasta el tope de mora y luego deja de avisar', () => {
    const r1 = getDueReminders([card], txs, dayBefore(-1), [5, 1]);
    expect(r1).toHaveLength(1);
    expect(r1[0].days).toBe(-1);
    expect(r1[0].isOverdue).toBe(true);
    expect(r1[0].offsetKey).toBe(-1);

    expect(getDueReminders([card], txs, dayBefore(-OVERDUE_MAX_DAYS), [5, 1])).toHaveLength(1);
    expect(getDueReminders([card], txs, dayBefore(-OVERDUE_MAX_DAYS - 1), [5, 1])).toHaveLength(0);
  });

  it('no repite un aviso ya registrado en la bitácora', () => {
    const sent = new Set([reminderKey('c1', '2026-06-05', 5)]);
    expect(getDueReminders([card], txs, dayBefore(5), [5, 1], sent)).toHaveLength(0);
    // Otra antelación del mismo ciclo sí debe salir.
    expect(getDueReminders([card], txs, dayBefore(1), [5, 1], sent)).toHaveLength(1);
  });

  it('no avisa una tarjeta ya pagada', () => {
    const paid = { ...card, payments: [{ id: 'p1', amount: 5000, date: '2026-05-25' }] };
    expect(getDueReminders([paid], txs, dayBefore(5), [5, 1])).toHaveLength(0);
  });

  it('NO avisa hoy el día del vencimiento si la tarjeta ya fue pagada ayer', () => {
    // Vence hoy (2026-06-05) y se pagó ayer (2026-06-04)
    const paid = { ...card, payments: [{ id: 'p1', amount: 5000, date: '2026-06-04' }] };
    expect(getDueReminders([paid], txs, dayBefore(0), [5, 1])).toHaveLength(0);
  });

  it('no avisa una tarjeta sin saldo facturado', () => {
    expect(getDueReminders([card], [], dayBefore(5), [5, 1])).toHaveLength(0);
  });

  it('usa pendingBilled y no totalBalance: ignora el consumo del ciclo abierto', () => {
    // 5000 facturados (10-may, ciclo cerrado) + 3000 del ciclo abierto (25-may),
    // que aún no vence. El aviso debe cobrar solo los 5000.
    const conAbierto = [...txs, { cardId: 'c1', date: '2026-05-25', amount: 3000, cashbackEarned: 0 }];
    const r = getDueReminders([card], conAbierto, dayBefore(5), [5, 1]);
    expect(r[0].amount).toBe(5000);
  });

  it('descuenta los abonos parciales del monto a avisar', () => {
    const conAbono = { ...card, payments: [{ id: 'p1', amount: 2000, date: '2026-05-25' }] };
    const r = getDueReminders([conAbono], txs, dayBefore(5), [5, 1]);
    expect(r[0].amount).toBe(3000);
  });

  it('incluye el saldo inicial (openingBalance) en el monto', () => {
    const conApertura = { ...card, openingBalance: 1500 };
    const r = getDueReminders([conApertura], txs, dayBefore(5), [5, 1]);
    expect(r[0].amount).toBe(6500);
  });

  it('ordena varias tarjetas del mismo día por urgencia', () => {
    // Segunda tarjeta: corte 20 / pago 1 → vence el 2026-06-01, es decir 4 días
    // antes que la primera. El 2026-05-31 le falta 1 día y a la otra 5.
    const card2 = { id: 'c2', name: 'Mastercard BHD', bank: 'BHD', cutoffDay: 20, dueDay: 1, payments: [] };
    const txs2 = [...txs, { cardId: 'c2', date: '2026-05-10', amount: 800, cashbackEarned: 0 }];
    const r = getDueReminders([card, card2], txs2, new Date(2026, 4, 31), [5, 1]);
    expect(r.map((x) => x.cardId)).toEqual(['c2', 'c1']);
    expect(r[0].days).toBe(1);
    expect(r[1].days).toBe(5);
  });

  it('ignora tarjetas sin id', () => {
    expect(getDueReminders([{ name: 'rota', cutoffDay: 20, dueDay: 5 }], txs, dayBefore(5), [5, 1])).toHaveLength(0);
  });

  it('cae a las antelaciones por defecto si la configuración viene vacía', () => {
    expect(getDueReminders([card], txs, dayBefore(5), [])).toHaveLength(1);
  });
});

describe('todayInZone', () => {
  it('devuelve el día de Santo Domingo, no el de UTC', () => {
    // 2026-09-20T02:00:00Z es todavía el 19 en Santo Domingo (UTC-4).
    const d = todayInZone('America/Santo_Domingo', new Date('2026-09-20T02:00:00Z'));
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8); // septiembre
    expect(d.getDate()).toBe(19);
  });

  it('coincide con UTC a media mañana', () => {
    const d = todayInZone('America/Santo_Domingo', new Date('2026-09-19T10:00:00Z'));
    expect(d.getDate()).toBe(19);
  });
});
