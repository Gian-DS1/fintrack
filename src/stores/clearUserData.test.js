import { describe, it, expect, vi, afterEach } from 'vitest';
import { simulationKey } from '../stitch/screens/projection/simulationStorage';

// Al cerrar sesión no puede quedar la simulación de «Proyección» de ese usuario en
// el dispositivo (localStorage), igual que no quedan sus stores.
function fakeLocalStorage(initial) {
  const data = { ...initial };
  return {
    data,
    get length() { return Object.keys(data).length; },
    key: (i) => Object.keys(data)[i] ?? null,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

describe('clearUserData', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('borra la simulación guardada de la proyección y respeta otras preferencias del dispositivo', async () => {
    const storage = fakeLocalStorage({
      [simulationKey('user-1')]: '{"scenario":"cuts"}',
      'fintrack-nav-collapsed': '1',
    });
    vi.stubGlobal('localStorage', storage);
    // Los stores persistidos solo exponen `persist` si hay sessionStorage al crearse.
    vi.stubGlobal('sessionStorage', fakeLocalStorage({}));
    vi.resetModules();
    const { clearUserData } = await import('./clearUserData');

    clearUserData();

    expect(Object.keys(storage.data)).toEqual(['fintrack-nav-collapsed']);
  });
});
