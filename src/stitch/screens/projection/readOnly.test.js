import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Criterio 7 de la entrega 3: simular no escribe en stores ni en Supabase. La
// función de cálculo es pura (ver cashflowProjection.test.js); aquí se vigila que
// la pantalla solo LEA los stores con selectores de datos y que sus componentes no
// toquen stores ni red.
const here = dirname(fileURLToPath(import.meta.url));
const screenFile = join(here, '..', 'StitchProjection.jsx');
const childFiles = readdirSync(here)
  .filter((f) => /\.(jsx?|mjs)$/.test(f) && !/\.test\./.test(f))
  .map((f) => join(here, f));

// Se ignoran los comentarios: pueden nombrar las acciones para explicarlas.
const codeOf = (file) => readFileSync(file, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

// Únicas propiedades de store que la pantalla puede leer.
const READ_ONLY_PROPS = ['transactions', 'categories', 'debts', 'payments', 'cards', 'recurring', 'initialCashBalance', 'currency'];

describe('la pantalla de proyección no escribe datos', () => {
  it('encuentra la pantalla y sus componentes', () => {
    expect(childFiles.length).toBeGreaterThanOrEqual(7);
  });

  it.each([screenFile, ...childFiles].map((f) => [f.split('/').slice(-2).join('/'), f]))(
    '%s no usa Supabase, red ni setState de stores',
    (_name, file) => {
      const code = codeOf(file);
      expect(code).not.toMatch(/\bsupabase\b/);
      expect(code).not.toMatch(/\bfetch\s*\(/);
      expect(code).not.toMatch(/\.setState\s*\(/);
    },
  );

  it.each(childFiles.map((f) => [f.split('/').slice(-2).join('/'), f]))(
    '%s no importa ningún store',
    (_name, file) => {
      expect(codeOf(file)).not.toMatch(/from\s+['"][^'"]*\/stores\//);
    },
  );

  it('la pantalla solo lee los stores con selectores de datos', () => {
    const screen = codeOf(screenFile);
    // Toda llamada a un store debe ser `useXStore((s) => s.prop)` con prop de lectura.
    const calls = screen.match(/use\w+Store\(/g) || [];
    const selectors = [...screen.matchAll(/use\w+Store\(\(s\) => s\.(\w+)\)/g)].map((m) => m[1]);
    expect(calls.length).toBe(READ_ONLY_PROPS.length);
    expect(selectors.sort()).toEqual([...READ_ONLY_PROPS].sort());
  });
});
