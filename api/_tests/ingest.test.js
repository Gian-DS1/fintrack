// /api/ingest — el handler completo con Supabase simulado.
//
// Vive en api/_tests/ a propósito: Vercel despliega como función cada .js de
// api/ salvo los de carpetas que empiezan con guion bajo.
//
// La lógica de parsing y armado de la fila se prueba en src/utils/ingest*.test.js;
// aquí se fija el CONTRATO HTTP: autenticación, códigos de respuesta, qué se le
// pasa a la función SQL y que toda lectura va filtrada por el usuario del token.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateToken, hashToken } from '../../src/utils/ingestToken.js';

const db = vi.hoisted(() => ({
  tokens: [],          // [{ id, user_id, token_hash }]
  tables: {},          // nombre → filas
  rpcResult: { data: { status: 'created', id: 'tx-1' }, error: null },
  tokenError: null,
  log: [],             // consultas hechas: { table, filters } | { rpc, args } | { update }
  clients: 0,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    db.clients += 1;
    const query = (table) => {
      const filters = {};
      const builder = {
        select: () => builder,
        order: () => builder,
        limit: () => builder,
        eq: (column, value) => { filters[column] = value; return builder; },
        maybeSingle: async () => {
          db.log.push({ table, filters });
          if (table === 'ingest_tokens') {
            if (db.tokenError) return { data: null, error: db.tokenError };
            return { data: db.tokens.find((t) => t.token_hash === filters.token_hash) || null, error: null };
          }
          return { data: (db.tables[table] || [])[0] || null, error: null };
        },
        update: (patch) => ({
          eq: async (column, value) => { db.log.push({ update: table, patch, [column]: value }); return { error: null }; },
        }),
        // `await builder` (consultas de lista).
        then: (resolve) => {
          db.log.push({ table, filters });
          return resolve({ data: db.tables[table] || [], error: null });
        },
      };
      return builder;
    };
    return {
      from: query,
      rpc: async (name, args) => { db.log.push({ rpc: name, args }); return db.rpcResult; },
    };
  },
}));

const { default: handler } = await import('../ingest.js');

async function call({ method = 'POST', token, body, headers } = {}) {
  const out = { status: null, body: null };
  const res = {
    status(code) { out.status = code; return this; },
    json(payload) { out.body = payload; return this; },
  };
  const auth = token === undefined ? {} : { authorization: `Bearer ${token}` };
  await handler({ method, headers: { ...auth, ...headers }, body }, res);
  return out;
}

let token;

beforeEach(async () => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role');
  vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  token = generateToken();
  db.tokens = [{ id: 'tok-1', user_id: 'user-1', token_hash: await hashToken(token) }];
  db.tables = {
    profiles: [{ currency: 'DOP' }],
    categories: [{ id: 'cat-super', name: 'Supermercado', type: 'variable_expense', keywords: ['supermercado', 'bravo'], is_active: true }],
    credit_cards: [{ id: 'card-pop', name: 'MC CCN Plus', bank: 'Popular', last4: '1234', cashback_rules: [{ categoryId: 'all', percentage: 2 }] }],
    transactions: [],
  };
  db.rpcResult = { data: { status: 'created', id: 'tx-1' }, error: null };
  db.tokenError = null;
  db.log = [];
  db.clients = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const rpcArgs = () => db.log.find((entry) => entry.rpc)?.args;

describe('/api/ingest — acceso', () => {
  it('solo acepta POST', async () => {
    expect((await call({ method: 'GET', token })).status).toBe(405);
  });

  it('sin service_role key responde 503 y no construye el cliente admin', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const r = await call({ token, body: { amount: 100 } });
    expect(r.status).toBe(503);
    expect(db.clients).toBe(0);
  });

  it('rechaza peticiones sin token o con forma inválida sin tocar la base', async () => {
    expect((await call({ body: { amount: 100 } })).status).toBe(401);
    expect((await call({ token: 'no-es-un-token', body: { amount: 100 } })).status).toBe(401);
    expect((await call({ headers: { authorization: `Basic ${token}` }, body: { amount: 100 } })).status).toBe(401);
    expect(db.clients).toBe(0);
  });

  it('rechaza un token bien formado pero desconocido (o revocado) sin registrar nada', async () => {
    const r = await call({ token: generateToken(), body: { amount: 100 } });
    expect(r.status).toBe(401);
    expect(rpcArgs()).toBeUndefined();
  });

  it('si la tabla de tokens no existe (migración sin correr) responde 503', async () => {
    db.tokenError = { message: 'relation "ingest_tokens" does not exist' };
    expect((await call({ token, body: { amount: 100 } })).status).toBe(503);
  });

  it('valida el cuerpo: JSON obligatorio y texto acotado', async () => {
    expect((await call({ token, body: undefined })).status).toBe(400);
    expect((await call({ token, body: 'no-json' })).status).toBe(400);
    expect((await call({ token, body: { text: 'x'.repeat(50_001) } })).status).toBe(413);
  });
});

describe('/api/ingest — registro', () => {
  it('Apple Pay: registra con categoría, tarjeta y cashback, y responde 201', async () => {
    const r = await call({ token, body: { amount: 'RD$1,250.00', merchant: 'Supermercados Nacional', card: 'MC CCN Plus' } });

    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ ok: true, status: 'created', id: 'tx-1' });
    expect(r.body.message).toContain('Supermercados Nacional');
    expect(rpcArgs()).toMatchObject({
      p_user_id: 'user-1', p_amount: 1250, p_type: 'variable_expense',
      p_description: 'Supermercados Nacional', p_category_id: 'cat-super', p_card_id: 'card-pop',
      p_currency: 'DOP', p_cashback: 25, p_notes: null, p_source: 'shortcut', p_external_id: null,
    });
    expect(rpcArgs().p_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('correo del banco: acepta el cuerpo como string JSON y extrae los campos', async () => {
    const text = 'Se realizó un consumo con su tarjeta terminada en 1234 por RD$450.00 en BRAVO.';
    const r = await call({ token, body: JSON.stringify({ text, id: 'gmail-msg-1' }) });

    expect(r.status).toBe(201);
    expect(rpcArgs()).toMatchObject({
      p_amount: 450, p_description: 'BRAVO', p_card_id: 'card-pop', p_source: 'email', p_external_id: 'gmail-msg-1',
    });
  });

  it('toda lectura va filtrada por el usuario dueño del token', async () => {
    await call({ token, body: { amount: 100 } });
    const reads = db.log.filter((entry) => entry.table && entry.table !== 'ingest_tokens');
    expect(reads.map((entry) => entry.table).sort()).toEqual(['categories', 'credit_cards', 'profiles', 'transactions']);
    for (const read of reads) expect(read.filters).toEqual({ user_id: 'user-1' });
  });

  it('marca el uso del token tras registrar', async () => {
    await call({ token, body: { amount: 100 } });
    expect(db.log.find((entry) => entry.update === 'ingest_tokens')).toMatchObject({ id: 'tok-1' });
  });

  it('duplicado → 200 con el id existente', async () => {
    db.rpcResult = { data: { status: 'duplicate', id: 'tx-0' }, error: null };
    const r = await call({ token, body: { amount: 100, merchant: 'Bravo' } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'duplicate', id: 'tx-0' });
  });

  it('límite por hora → 429', async () => {
    db.rpcResult = { data: { status: 'rate_limited', id: null }, error: null };
    expect((await call({ token, body: { amount: 100 } })).status).toBe(429);
  });

  it('un correo que no es un consumo responde 200 "skipped" y no escribe', async () => {
    const r = await call({ token, body: { text: 'Su consumo por RD$500.00 fue declinado.' } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'skipped', reason: 'declined' });
    expect(rpcArgs()).toBeUndefined();
  });

  it('sin monto → 422', async () => {
    expect((await call({ token, body: { merchant: 'Bravo' } })).status).toBe(422);
    expect((await call({ token, body: [] })).status).toBe(422);
  });

  it('un fallo de la base responde 500 genérico, sin filtrar el detalle', async () => {
    db.rpcResult = { data: null, error: { message: 'detalle interno de postgres' } };
    const r = await call({ token, body: { amount: 100 } });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('postgres');
  });
});
