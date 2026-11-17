import { describe, it, expect } from 'vitest';
import { buildIngestTransaction } from './ingestBuild.js';

const categories = [
  { id: 'cat-super', name: 'Supermercado', type: 'variable_expense', keywords: ['supermercado', 'bravo'], isActive: true },
  { id: 'cat-transp', name: 'Transporte', type: 'variable_expense', keywords: ['uber'], isActive: true },
  { id: 'cat-renta', name: 'Alquiler', type: 'fixed_expense', keywords: ['alquiler'], isActive: true },
  { id: 'cat-sueldo', name: 'Salario', type: 'income', keywords: ['nomina', 'empresa'], isActive: true },
];
const cards = [
  { id: 'card-pop', name: 'MC CCN Plus', bank: 'Banco Popular', last4: '1234', cashbackRules: [{ categoryId: 'cat-super', percentage: 5 }] },
  { id: 'card-qik', name: 'Qik Visa', bank: 'Qik', last4: '9876', cashbackRules: [{ categoryId: 'all', percentage: 1 }] },
];
const ctx = (extra = {}) => ({ categories, cards, history: [], currency: 'DOP', todayISO: '2026-11-17', ...extra });

describe('buildIngestTransaction — atajo de Apple Pay (campos explícitos)', () => {
  it('arma la fila con categoría por palabra clave, tarjeta y cashback', () => {
    const r = buildIngestTransaction(
      { amount: 'RD$1,250.00', merchant: 'Supermercados Nacional', card: 'MC CCN Plus' },
      ctx(),
    );
    expect(r).toEqual({
      ok: true,
      row: {
        amount: 1250, date: '2026-11-17', type: 'variable_expense',
        description: 'Supermercados Nacional', categoryId: 'cat-super', cardId: 'card-pop',
        currency: 'DOP', cashbackEarned: 62.5, notes: null, source: 'shortcut', externalId: null,
      },
      meta: { categoryName: 'Supermercado', cardName: 'MC CCN Plus', foreignCurrency: null },
    });
  });

  it('una tarjeta que no casa queda sin tarjeta (débito), aunque el historial sugiera otra', () => {
    const history = [{ description: 'Uber', categoryId: 'cat-transp', cardId: 'card-qik', date: '2026-11-01' }];
    const r = buildIngestTransaction({ amount: 300, merchant: 'Uber', card: 'Débito Banreservas' }, ctx({ history }));
    expect(r.row.cardId).toBeNull();
    expect(r.row.cashbackEarned).toBe(0);
  });

  it('sin comercio usa una descripción genérica y queda sin categoría', () => {
    const r = buildIngestTransaction({ amount: 99 }, ctx());
    expect(r.row).toMatchObject({ description: 'Apple Pay', categoryId: null, type: 'variable_expense' });
  });

  it('respeta una fecha explícita plausible', () => {
    const r = buildIngestTransaction({ amount: 99, date: '2026-11-15' }, ctx());
    expect(r.row.date).toBe('2026-11-15');
  });

  it('no usa categorías desactivadas, ni por palabra clave ni por historial', () => {
    const inactive = categories.map((c) => (c.id === 'cat-transp' ? { ...c, isActive: false } : c));
    const history = [{ description: 'Uber', categoryId: 'cat-transp', cardId: null, date: '2026-11-01' }];
    const r = buildIngestTransaction({ amount: 300, merchant: 'Uber' }, ctx({ categories: inactive, history }));
    expect(r.row.categoryId).toBeNull();
  });

  it('un texto de rechazo anula el registro aunque venga un monto explícito', () => {
    expect(buildIngestTransaction({ amount: 500, text: 'Su consumo por RD$500.00 fue declinado.' }, ctx()))
      .toEqual({ ok: false, skip: 'declined' });
  });

  it('tolera cuerpos y campos con tipos inesperados sin lanzar', () => {
    for (const bad of [null, undefined, 5, 'x', [], true]) {
      expect(buildIngestTransaction(bad, ctx())).toEqual({ ok: false, error: 'missing_amount' });
    }
    const r = buildIngestTransaction({ amount: 10, merchant: {}, card: [], last4: {}, date: true, text: 7, source: {} }, ctx());
    expect(r.row).toMatchObject({ amount: 10, description: 'Apple Pay', cardId: null, date: '2026-11-17', source: 'shortcut' });
  });

  it('acepta un id de mensaje acotado y descarta los que no son seguros', () => {
    const id = (value) => buildIngestTransaction({ amount: 5, id: value }, ctx()).row.externalId;
    expect(id('18c2f0a9b7d1e3f4')).toBe('18c2f0a9b7d1e3f4');
    expect(id(12345)).toBe('12345');
    expect(id('  con-espacios-alrededor ')).toBe('con-espacios-alrededor');
    expect(id('con espacio')).toBeNull();
    expect(id('x'.repeat(129))).toBeNull();
    expect(id({})).toBeNull();
    expect(id('')).toBeNull();
  });

  it('rechaza la petición sin monto ni texto', () => {
    expect(buildIngestTransaction({ merchant: 'Bravo' }, ctx())).toEqual({ ok: false, error: 'missing_amount' });
    expect(buildIngestTransaction(undefined, ctx())).toEqual({ ok: false, error: 'missing_amount' });
  });
});

describe('buildIngestTransaction — correo del banco (texto crudo)', () => {
  const email = 'Se realizó un consumo con su tarjeta terminada en 9876 por RD$450.00 en UBER TRIP el 16/11/2026.';

  it('extrae todo del texto y casa la tarjeta por últimos 4', () => {
    const r = buildIngestTransaction({ text: email }, ctx());
    expect(r.row).toEqual({
      amount: 450, date: '2026-11-16', type: 'variable_expense', description: 'UBER TRIP',
      categoryId: 'cat-transp', cardId: 'card-qik', currency: 'DOP', cashbackEarned: 4.5,
      notes: null, source: 'email', externalId: null,
    });
  });

  it('el historial del usuario manda sobre las palabras clave', () => {
    const history = [
      { description: 'UBER TRIP', categoryId: 'cat-renta', cardId: 'card-qik', date: '2026-10-01' },
      { description: 'UBER TRIP', categoryId: 'cat-renta', cardId: 'card-qik', date: '2026-10-08' },
    ];
    const r = buildIngestTransaction({ text: email }, ctx({ history }));
    expect(r.row).toMatchObject({ categoryId: 'cat-renta', type: 'fixed_expense' });
  });

  it('sin pista de tarjeta usa la que el usuario suele usar en ese comercio', () => {
    const history = [{ description: 'Bravo', categoryId: 'cat-super', cardId: 'card-pop', date: '2026-11-01' }];
    const r = buildIngestTransaction({ text: 'Compra aprobada por RD$800.00 en BRAVO' }, ctx({ history }));
    expect(r.row).toMatchObject({ cardId: 'card-pop', categoryId: 'cat-super', cashbackEarned: 40 });
  });

  it('nunca asigna una categoría de ingreso a un consumo', () => {
    const r = buildIngestTransaction({ text: 'Compra aprobada por RD$800.00 en EMPRESA XYZ' }, ctx());
    expect(r.row).toMatchObject({ categoryId: null, type: 'variable_expense' });
  });

  it('marca los montos en otra moneda en lugar de convertirlos a ciegas', () => {
    const r = buildIngestTransaction({ text: 'Compra aprobada por US$ 20.00 en AMAZON' }, ctx());
    expect(r.row.amount).toBe(20);
    expect(r.row.notes).toMatch(/USD.*sin convertir a DOP/);
    expect(r.meta.foreignCurrency).toBe('USD');
  });

  it('propaga como "skip" lo que no es un consumo y como error la falta de monto', () => {
    expect(buildIngestTransaction({ text: 'Su consumo por RD$500.00 fue rechazado.' }, ctx()))
      .toEqual({ ok: false, skip: 'declined' });
    expect(buildIngestTransaction({ text: 'Realizaste una compra en TIENDA.' }, ctx()))
      .toEqual({ ok: false, error: 'missing_amount' });
  });

  it('con monto explícito el texto solo aporta contexto y el origen lo fija `source`', () => {
    const r = buildIngestTransaction({ amount: 450, text: email, source: 'email' }, ctx());
    expect(r.row).toMatchObject({ amount: 450, description: 'UBER TRIP', cardId: 'card-qik', source: 'email' });
  });
});
