// Rama Supabase del store de tarjetas: qué columnas viajan a la base.
//
// `last4` (registro automático) llegó con la migración add_auto_ingest.sql. El
// store solo debe enviarla cuando hay algo que escribir o que borrar: así crear
// y editar tarjetas sigue funcionando en una base que aún no tiene la columna.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const calls = vi.hoisted(() => ({ insert: [], update: [] }));

vi.mock('../stitch/demoFlag', async (importOriginal) => ({
  ...(await importOriginal()),
  isDemoActive: () => false,
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

vi.mock('../lib/supabase', () => ({
  getCurrentUser: async () => ({ id: 'user-1' }),
  supabase: {
    from: () => ({
      insert: (payload) => {
        calls.insert.push(payload);
        return { select: () => ({ single: async () => ({ data: { id: 'card-1', ...payload }, error: null }) }) };
      },
      update: (payload) => {
        calls.update.push(payload);
        return { eq: async () => ({ error: null }) };
      },
    }),
  },
}));

const { default: useCreditCardStore } = await import('./useCreditCardStore');
const store = () => useCreditCardStore.getState();

const baseCard = { name: 'MC CCN Plus', bank: 'Popular', cutoffDay: 15, dueDay: 5, cashbackRules: [] };

beforeEach(() => {
  calls.insert.length = 0;
  calls.update.length = 0;
  useCreditCardStore.setState({ cards: [], loading: false });
});

describe('tarjetas con Supabase — columna last4', () => {
  it('al crear sin dígitos no envía la columna', async () => {
    await store().addCard(baseCard);
    expect(calls.insert[0]).not.toHaveProperty('last4');
    expect(store().cards[0].last4).toBe('');
  });

  it('al crear con dígitos los envía y quedan en el estado', async () => {
    await store().addCard({ ...baseCard, last4: '1234' });
    expect(calls.insert[0].last4).toBe('1234');
    expect(store().cards[0].last4).toBe('1234');
  });

  it('al editar una tarjeta sin dígitos, dejándolos vacíos, no toca la columna', async () => {
    useCreditCardStore.setState({ cards: [{ id: 'card-1', ...baseCard, last4: '' }] });
    await store().updateCard('card-1', { name: 'Otro nombre', last4: '' });
    expect(calls.update[0]).toEqual({ name: 'Otro nombre' });
  });

  it('al editar permite escribir los dígitos y también borrarlos', async () => {
    useCreditCardStore.setState({ cards: [{ id: 'card-1', ...baseCard, last4: '' }] });
    await store().updateCard('card-1', { last4: '9876' });
    expect(calls.update[0]).toEqual({ last4: '9876' });
    expect(store().cards[0].last4).toBe('9876');

    await store().updateCard('card-1', { last4: '' });
    expect(calls.update[1]).toEqual({ last4: null });
  });
});
