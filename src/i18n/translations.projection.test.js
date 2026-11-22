import { describe, it, expect } from 'vitest';
import translations from './translations';

// Las dos lenguas deben tener exactamente las mismas claves y los mismos
// marcadores {x} en la pantalla de proyección.
const placeholders = (text) => (text.match(/\{\w+\}/g) || []).sort();

describe('i18n · proyección (es y en)', () => {
  const es = translations.es.projection;
  const en = translations.en.projection;

  it('existe en las dos lenguas con las mismas claves', () => {
    expect(es).toBeDefined();
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
  });

  it('todas las cadenas tienen texto y los mismos marcadores en es y en', () => {
    for (const key of Object.keys(es)) {
      expect(typeof es[key], key).toBe('string');
      expect(es[key].trim().length, key).toBeGreaterThan(0);
      expect(placeholders(en[key]), key).toEqual(placeholders(es[key]));
    }
  });

  it('la entrada de navegación y el enlace del Resumen existen en las dos lenguas', () => {
    for (const lang of ['es', 'en']) {
      expect(translations[lang].nav.projection).toBeTruthy();
      expect(translations[lang].dashboard.seeProjection).toBeTruthy();
    }
  });
});
