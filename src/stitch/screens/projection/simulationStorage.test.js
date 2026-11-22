import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SIMULATION, simulationKey, loadSimulation, saveSimulation, clearSimulations,
} from './simulationStorage';

// Almacén falso con la misma forma que localStorage.
function fakeStorage(initial = {}) {
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
const throwing = () => ({
  get length() { throw new Error('bloqueado'); },
  key: () => { throw new Error('bloqueado'); },
  getItem: () => { throw new Error('bloqueado'); },
  setItem: () => { throw new Error('bloqueado'); },
  removeItem: () => { throw new Error('bloqueado'); },
});
const U = 'user-1';
const withSaved = (value, userId = U) => fakeStorage({ [simulationKey(userId)]: typeof value === 'string' ? value : JSON.stringify(value) });

describe('simulationKey', () => {
  it('está versionada y es por usuario', () => {
    expect(simulationKey('abc')).toBe('fintrack-projection-simulation:v1:abc');
    expect(simulationKey('abc')).not.toBe(simulationKey('xyz'));
  });
});

describe('loadSimulation', () => {
  it('sin nada guardado devuelve los valores por defecto', () => {
    expect(loadSimulation(U, fakeStorage())).toEqual(DEFAULT_SIMULATION);
    expect(DEFAULT_SIMULATION).toEqual({
      scenario: 'current', cutPct: 0.2, excludedRecurringIds: [],
      variableOverride: null, essentialCategoryIds: [], includeFixedUnscheduled: true,
    });
  });

  it('si el almacenamiento falla, devuelve los valores por defecto', () => {
    expect(loadSimulation(U, throwing())).toEqual(DEFAULT_SIMULATION);
  });

  it('sin almacenamiento disponible (p. ej. Node), devuelve los valores por defecto', () => {
    expect(loadSimulation(U, null)).toEqual(DEFAULT_SIMULATION);
  });

  it('JSON inválido → valores por defecto', () => {
    expect(loadSimulation(U, withSaved('{no es json'))).toEqual(DEFAULT_SIMULATION);
    expect(loadSimulation(U, withSaved('42'))).toEqual(DEFAULT_SIMULATION);
  });

  it('lee lo guardado', () => {
    const saved = {
      scenario: 'cuts', cutPct: 0.3, excludedRecurringIds: ['a', 'b'],
      variableOverride: 12000, essentialCategoryIds: ['food'], includeFixedUnscheduled: false,
    };
    expect(loadSimulation(U, withSaved(saved))).toEqual(saved);
  });

  it('cada usuario lee solo lo suyo', () => {
    const storage = withSaved({ scenario: 'cuts' }, 'otro');
    expect(loadSimulation(U, storage)).toEqual(DEFAULT_SIMULATION);
    expect(loadSimulation('otro', storage).scenario).toBe('cuts');
  });

  it('sanea valores fuera de rango o de tipo equivocado, campo por campo', () => {
    const raw = {
      scenario: 'otro', cutPct: 0.9, excludedRecurringIds: ['a', 7, null], variableOverride: -5,
      essentialCategoryIds: 'food', includeFixedUnscheduled: 'no',
    };
    expect(loadSimulation(U, withSaved(raw))).toEqual({
      scenario: 'current', cutPct: 0.5, excludedRecurringIds: ['a'],
      variableOverride: null, essentialCategoryIds: [], includeFixedUnscheduled: true,
    });
  });

  it('el recorte nunca baja de 10 %', () => {
    expect(loadSimulation(U, withSaved({ cutPct: 0.01 })).cutPct).toBe(0.1);
  });

  it('una corrección manual de 0 se conserva', () => {
    expect(loadSimulation(U, withSaved({ variableOverride: 0 })).variableOverride).toBe(0);
  });

  it('un campo que falta toma su valor por defecto', () => {
    expect(loadSimulation(U, withSaved({ scenario: 'essential' }))).toEqual({ ...DEFAULT_SIMULATION, scenario: 'essential' });
  });
});

describe('saveSimulation', () => {
  it('guarda y se puede volver a leer', () => {
    const storage = fakeStorage();
    const sim = { ...DEFAULT_SIMULATION, scenario: 'essential', essentialCategoryIds: ['food'] };
    expect(saveSimulation(sim, U, storage)).toBe(true);
    expect(loadSimulation(U, storage)).toEqual(sim);
    expect(Object.keys(storage.data)).toEqual([simulationKey(U)]);
  });

  it('si el almacenamiento falla no lanza y avisa con false', () => {
    expect(saveSimulation(DEFAULT_SIMULATION, U, throwing())).toBe(false);
    expect(saveSimulation(DEFAULT_SIMULATION, U, null)).toBe(false);
  });
});

describe('clearSimulations', () => {
  it('borra la simulación de todos los usuarios, también la clave antigua sin versión, y respeta lo demás', () => {
    const storage = fakeStorage({
      [simulationKey('a')]: '{}', [simulationKey('b')]: '{}',
      'fintrack-projection-simulation': '{}',
      'fintrack-nav-collapsed': '1', stitch_language: 'es',
    });
    clearSimulations(storage);
    expect(Object.keys(storage.data).sort()).toEqual(['fintrack-nav-collapsed', 'stitch_language']);
  });

  it('si el almacenamiento falla, no lanza', () => {
    expect(() => clearSimulations(throwing())).not.toThrow();
    expect(() => clearSimulations(null)).not.toThrow();
  });
});
