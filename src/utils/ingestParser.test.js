import { describe, it, expect } from 'vitest';
import {
  parseAmount, detectCurrency, cleanMerchant, htmlToText, parseDate,
  parseNotificationText, matchCard, resolveDate,
} from './ingestParser.js';

describe('parseAmount', () => {
  it('acepta números y redondea a 2 decimales', () => {
    expect(parseAmount(1250)).toBe(1250);
    expect(parseAmount(12.345)).toBe(12.35);
  });

  it('lee el formato dominicano/estadounidense (coma de miles, punto decimal)', () => {
    expect(parseAmount('RD$1,250.00')).toBe(1250);
    expect(parseAmount('US$ 12.50')).toBe(12.5);
    expect(parseAmount('$1,234,567.89')).toBe(1234567.89);
  });

  it('lee el formato europeo (punto de miles, coma decimal)', () => {
    expect(parseAmount('1.250,00 €')).toBe(1250);
    expect(parseAmount('12,50 €')).toBe(12.5);
    expect(parseAmount('1.250.000')).toBe(1250000);
  });

  it('una sola coma agrupando de a 3 es separador de miles', () => {
    expect(parseAmount('1,250')).toBe(1250);
    expect(parseAmount('RD$ 25,000')).toBe(25000);
  });

  it('rechaza vacío, cero, negativos y basura', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount('gratis')).toBeNull();
    expect(parseAmount(0)).toBeNull();
    expect(parseAmount(-5)).toBeNull();
    expect(parseAmount(NaN)).toBeNull();
  });
});

describe('detectCurrency', () => {
  it('distingue RD$, US$ y códigos ISO; `$` solo es ambiguo', () => {
    expect(detectCurrency('RD$1,250.00')).toBe('DOP');
    expect(detectCurrency('US$12.50')).toBe('USD');
    expect(detectCurrency('12.50 USD')).toBe('USD');
    expect(detectCurrency('12,50 €')).toBe('EUR');
    expect(detectCurrency('$12.50')).toBeNull();
    expect(detectCurrency(1250)).toBeNull();
  });
});

describe('cleanMerchant', () => {
  it('colapsa espacios, quita signos sueltos y neutraliza HTML', () => {
    expect(cleanMerchant('  SUPERMERCADOS   NACIONAL. ')).toBe('SUPERMERCADOS NACIONAL');
    expect(cleanMerchant(': <b>UBER</b> *TRIP')).toBe('bUBER/b *TRIP');
    expect(cleanMerchant(null)).toBe('');
  });

  it('acota la longitud', () => {
    expect(cleanMerchant('A'.repeat(500))).toHaveLength(120);
  });
});

describe('htmlToText', () => {
  it('convierte celdas y saltos en líneas y descarta estilos', () => {
    const html = '<style>td{color:red}</style><table><tr><td>Monto:</td><td>RD&#36;500.00</td></tr><tr><td>Comercio:</td><td>BRAVO&nbsp;S.A.</td></tr></table>';
    expect(htmlToText(html)).toBe('Monto:\nRD$500.00\nComercio:\nBRAVO S.A.');
  });
});

describe('parseDate', () => {
  it('lee dd/mm/aaaa, dd-mm-aa e ISO', () => {
    expect(parseDate('el 17/11/2026 a las 14:31')).toBe('2026-11-17');
    expect(parseDate('5-3-26')).toBe('2026-03-05');
    expect(parseDate('Fecha: 2026-11-17T14:31:00')).toBe('2026-11-17');
  });

  it('devuelve null si no hay fecha o es imposible', () => {
    expect(parseDate('sin fecha')).toBeNull();
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate(undefined)).toBeNull();
  });
});

describe('parseNotificationText', () => {
  it('extrae un consumo en una sola frase (estilo SMS)', () => {
    const r = parseNotificationText(
      'Se realizó un consumo con su tarjeta terminada en 1234 por RD$1,250.00 en SUPERMERCADOS NACIONAL el 17/11/2026 14:31.'
    );
    expect(r).toEqual({
      kind: 'purchase', amount: 1250, currency: 'DOP',
      merchant: 'SUPERMERCADOS NACIONAL', last4: '1234', date: '2026-11-17',
    });
  });

  it('extrae un consumo con campos etiquetados (estilo tabla HTML)', () => {
    const html = `
      <p>Notificación de consumo</p>
      <table>
        <tr><td>Tarjeta</td><td>****-****-****-9876</td></tr>
        <tr><td>Comercio:</td><td>UBER *TRIP</td></tr>
        <tr><td>Monto:</td><td>US$ 12.50</td></tr>
        <tr><td>Fecha:</td><td>16/11/2026</td></tr>
      </table>`;
    expect(parseNotificationText(html)).toEqual({
      kind: 'purchase', amount: 12.5, currency: 'USD',
      merchant: 'UBER *TRIP', last4: '9876', date: '2026-11-16',
    });
  });

  it('toma la moneda de una etiqueta aparte cuando el monto no la trae', () => {
    const r = parseNotificationText('Compra aprobada\nMonto: 45.00\nMoneda: USD\nComercio: AMAZON');
    expect(r).toMatchObject({ kind: 'purchase', amount: 45, currency: 'USD', merchant: 'AMAZON' });
  });

  it('funciona sin comercio, tarjeta ni fecha (se completan después)', () => {
    const r = parseNotificationText('Transacción aprobada por RD$300.00');
    expect(r).toEqual({ kind: 'purchase', amount: 300, currency: 'DOP', merchant: '', last4: null, date: null });
  });

  it('no confunde "en su tarjeta" con un comercio', () => {
    const r = parseNotificationText('Se aplicó un cargo en su tarjeta por RD$150.00 en FARMACIA CAROL');
    expect(r.merchant).toBe('FARMACIA CAROL');
  });

  it.each([
    ['declined', 'Su consumo por RD$5,000.00 en TIENDA fue declinado por fondos insuficientes.'],
    ['refund', 'Reverso de consumo por RD$5,000.00 en TIENDA.'],
    ['otp', 'Su código de verificación para la compra de RD$500.00 es 123456.'],
    ['payment_or_income', 'Pago recibido. Gracias por su pago de RD$10,000.00 a su tarjeta ****1234.'],
    ['not_a_purchase', 'Aprovecha: RD$500.00 de descuento este fin de semana.'],
    ['no_amount', 'Realizaste una compra en TIENDA con tu tarjeta.'],
    ['empty', '   '],
  ])('omite lo que no es un gasto: %s', (reason, text) => {
    expect(parseNotificationText(text)).toEqual({ kind: 'skip', reason });
  });
});

describe('matchCard', () => {
  const cards = [
    { id: 'a', name: 'MC CCN Plus', bank: 'Banco Popular', last4: '1234' },
    { id: 'b', name: 'Qik Visa', bank: 'Qik', last4: '9876' },
    { id: 'c', name: 'Visa', bank: 'BHD', last4: null },
  ];

  it('prioriza los últimos 4 dígitos', () => {
    expect(matchCard(cards, { last4: '9876' })?.id).toBe('b');
    expect(matchCard(cards, { name: 'Lo que diga Wallet', last4: '1234' })?.id).toBe('a');
  });

  it('lee los 4 dígitos del final del nombre que da Wallet', () => {
    expect(matchCard(cards, { name: 'Mastercard ••1234' })?.id).toBe('a');
  });

  it('casa por nombre, sin importar mayúsculas ni acentos', () => {
    expect(matchCard(cards, { name: 'mc ccn plus' })?.id).toBe('a');
    expect(matchCard(cards, { name: 'Banco Popular MC CCN Plus' })?.id).toBe('a');
  });

  it('ante varias coincidencias gana el nombre más específico', () => {
    expect(matchCard(cards, { name: 'Qik Visa' })?.id).toBe('b');
  });

  it('devuelve null sin pista, sin coincidencia o con empate real', () => {
    expect(matchCard(cards, {})).toBeNull();
    expect(matchCard(cards, { name: 'Débito Banreservas' })).toBeNull();
    expect(matchCard(cards, { last4: '0000' })).toBeNull();
    const twins = [{ id: 'x', name: 'Gold', last4: null }, { id: 'y', name: 'Gold', last4: null }];
    expect(matchCard(twins, { name: 'Gold' })).toBeNull();
  });
});

describe('resolveDate', () => {
  const today = '2026-11-17';

  it('acepta fechas recientes y la de mañana (desfase de zona horaria)', () => {
    expect(resolveDate('2026-11-16', today)).toBe('2026-11-16');
    expect(resolveDate('2026-11-18', today)).toBe('2026-11-18');
    expect(resolveDate('2026-10-17', today)).toBe('2026-10-17');
  });

  it('cae a hoy si falta, es inválida, muy vieja o futura', () => {
    expect(resolveDate(null, today)).toBe(today);
    expect(resolveDate('17/11/2026', today)).toBe(today);
    expect(resolveDate('2026-09-01', today)).toBe(today);
    expect(resolveDate('2026-12-25', today)).toBe(today);
  });
});
