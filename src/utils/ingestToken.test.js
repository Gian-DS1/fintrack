import { describe, it, expect } from 'vitest';
import { generateToken, hashToken, isTokenShape, tokenHint } from './ingestToken.js';

describe('ingestToken', () => {
  it('genera tokens con el prefijo y la forma esperada, sin repetirse', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^ft_[A-Za-z0-9_-]{43}$/);
    expect(isTokenShape(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('rechaza lo que no tiene forma de token', () => {
    expect(isTokenShape('')).toBe(false);
    expect(isTokenShape('ft_corto')).toBe(false);
    expect(isTokenShape(`xx_${'a'.repeat(43)}`)).toBe(false);
    expect(isTokenShape(`ft_${'a'.repeat(42)}!`)).toBe(false);
    expect(isTokenShape(null)).toBe(false);
  });

  it('hashea con SHA-256 en hex (vector conocido) y es determinista', async () => {
    expect(await hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const token = generateToken();
    expect(await hashToken(token)).toBe(await hashToken(token));
  });

  it('la pista son los últimos 4 caracteres', () => {
    expect(tokenHint('ft_abcdefgh')).toBe('efgh');
  });
});
