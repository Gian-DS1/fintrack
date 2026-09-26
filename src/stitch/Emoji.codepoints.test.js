// Valida que emojiCodepoint (conversión local) produce exactamente el
// codepoint canónico esperado (validado contra el snapshot de JoyPixels/emoji-toolkit).
// Corre sobre el catálogo curado completo + casos con tono de piel, ZWJ, banderas y keycaps.

import { describe, it, expect } from 'vitest';
import { EMOJI_CATALOG } from '../data/emojiCatalog';
import { emojiCodepoint } from './emojiCodepoint';
import EXPECTED_CODEPOINTS from './emojiCodepoints.fixture.json';

describe('emojiCodepoint', () => {
  it('coincide con la referencia canónica para todo el catálogo curado', () => {
    for (const { char } of EMOJI_CATALOG) {
      const expected = EXPECTED_CODEPOINTS[char];
      if (expected) {
        expect(emojiCodepoint(char), `emoji ${char}`).toBe(expected);
      }
    }
  });

  it('coincide en casos especiales (tonos, ZWJ, banderas, keycaps)', () => {
    const extras = ['👍🏽', '👨‍👩‍👦', '🇩🇴', '🇺🇸', '1️⃣', '#️⃣', '❤️', '☂️', '✈️'];
    for (const char of extras) {
      const expected = EXPECTED_CODEPOINTS[char];
      if (expected) {
        expect(emojiCodepoint(char), `emoji ${char}`).toBe(expected);
      }
    }
  });

  it('devuelve null para strings que no son emoji', () => {
    expect(emojiCodepoint('A')).toBe(null);
    expect(emojiCodepoint('123')).toBe(null);
    expect(emojiCodepoint('')).toBe(null);
    expect(emojiCodepoint(null)).toBe(null);
  });
});
