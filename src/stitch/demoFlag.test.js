// Detección del modo demo. Importante porque es la guarda que impide que el
// demo se active en producción: si isLocalhost() fallara abierto, la app
// serviría datos sembrados sin sesión.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { isLocalhost, isDemoActive, isFreshActive, setDemoFlag, setFreshFlag, clearDemoFlags } from './demoFlag';

const mem = new Map();
const fakeStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const atHost = (hostname) => vi.stubGlobal('window', { location: { hostname } });

beforeEach(() => {
  mem.clear();
  vi.stubGlobal('sessionStorage', fakeStorage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isLocalhost', () => {
  it('reconoce los hosts locales', () => {
    for (const h of ['localhost', '127.0.0.1', '[::1]']) {
      atHost(h);
      expect(isLocalhost()).toBe(true);
    }
  });

  it('es falso en cualquier host desplegado', () => {
    for (const h of ['fintrack-rd.vercel.app', 'example.com', 'localhost.evil.com']) {
      atHost(h);
      expect(isLocalhost()).toBe(false);
    }
  });

  it('es falso sin window (SSR / entorno node)', () => {
    vi.stubGlobal('window', undefined);
    expect(isLocalhost()).toBe(false);
  });
});

describe('isDemoActive / isFreshActive', () => {
  it('exige host local Y flag: en producción nunca se activa', () => {
    atHost('fintrack-rd.vercel.app');
    setDemoFlag();
    expect(isDemoActive()).toBe(false);
  });

  it('se activa en localhost con el flag demo', () => {
    atHost('localhost');
    expect(isDemoActive()).toBe(false);
    setDemoFlag();
    expect(isDemoActive()).toBe(true);
    expect(isFreshActive()).toBe(false);
  });

  it('el sub-modo fresh también cuenta como demo', () => {
    atHost('localhost');
    setFreshFlag();
    expect(isDemoActive()).toBe(true);
    expect(isFreshActive()).toBe(true);
  });

  it('clearDemoFlags apaga ambos modos', () => {
    atHost('localhost');
    setDemoFlag();
    setFreshFlag();
    clearDemoFlags();
    expect(isDemoActive()).toBe(false);
    expect(isFreshActive()).toBe(false);
  });

  it('no lanza si sessionStorage está bloqueado (modo privado)', () => {
    atHost('localhost');
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('blocked'); },
    });
    expect(() => isDemoActive()).not.toThrow();
    expect(isDemoActive()).toBe(false);
  });
});
