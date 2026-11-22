import { describe, it, expect } from 'vitest';
import { getNiceAxis } from './chartAxis';

describe('getNiceAxis', () => {
  it('siempre incluye el 0 y usa marcas redondas', () => {
    const { ticks, domain } = getNiceAxis([-223300, 1860421]);
    expect(ticks).toContain(0);
    expect(domain).toEqual([ticks[0], ticks[ticks.length - 1]]);
    expect(domain[0]).toBeLessThanOrEqual(-223300);
    expect(domain[1]).toBeGreaterThanOrEqual(1860421);
    const step = ticks[1] - ticks[0];
    expect([1, 2, 5].includes(step / 10 ** Math.floor(Math.log10(step)))).toBe(true);
    ticks.forEach((t) => expect(Math.abs(t % step)).toBe(0));
  });

  it('serie positiva: arranca en 0', () => {
    const { ticks } = getNiceAxis([100, 900]);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(900);
  });

  it('serie negativa: termina en 0', () => {
    const { ticks } = getNiceAxis([-900, -100]);
    expect(ticks[ticks.length - 1]).toBe(0);
    expect(ticks[0]).toBeLessThanOrEqual(-900);
  });

  it('serie plana en 0 no colapsa', () => {
    const { ticks, domain } = getNiceAxis([0, 0, 0]);
    expect(domain[1]).toBeGreaterThan(domain[0]);
    expect(ticks).toContain(0);
  });

  it('no genera demasiadas marcas', () => {
    expect(getNiceAxis([-5, 123456789]).ticks.length).toBeLessThanOrEqual(8);
  });
});
