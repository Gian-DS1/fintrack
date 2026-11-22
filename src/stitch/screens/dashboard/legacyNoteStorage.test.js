import { describe, it, expect } from 'vitest';
import {
  legacyNoteKey, isLegacyNoteDismissed, dismissLegacyNote, clearLegacyNotes,
} from './legacyNoteStorage';

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

describe('legacyNoteKey', () => {
  it('está versionada y es por usuario', () => {
    expect(legacyNoteKey('abc')).toBe('fintrack-legacy-paid-cycles-note:v1:abc');
  });
});

describe('nota de pagos legados: «Ya lo comprobé»', () => {
  it('por defecto no está cerrada', () => {
    expect(isLegacyNoteDismissed('u1', fakeStorage())).toBe(false);
  });

  it('al cerrarla queda guardada, solo para ese usuario', () => {
    const storage = fakeStorage();
    expect(dismissLegacyNote('u1', storage)).toBe(true);
    expect(isLegacyNoteDismissed('u1', storage)).toBe(true);
    expect(isLegacyNoteDismissed('u2', storage)).toBe(false);
  });

  it('con almacenamiento bloqueado no lanza: sigue visible y no se guarda', () => {
    expect(isLegacyNoteDismissed('u1', throwing())).toBe(false);
    expect(dismissLegacyNote('u1', throwing())).toBe(false);
  });

  it('sin almacenamiento (null) tampoco lanza', () => {
    expect(isLegacyNoteDismissed('u1', null)).toBe(false);
    expect(dismissLegacyNote('u1', null)).toBe(false);
  });

  it('clearLegacyNotes borra la de todos los usuarios y respeta lo demás', () => {
    const storage = fakeStorage({
      [legacyNoteKey('u1')]: '1', [legacyNoteKey('u2')]: '1', 'fintrack-nav-collapsed': '1',
    });
    clearLegacyNotes(storage);
    expect(Object.keys(storage.data)).toEqual(['fintrack-nav-collapsed']);
    expect(() => clearLegacyNotes(throwing())).not.toThrow();
  });
});
