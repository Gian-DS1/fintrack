import { describe, it, expect } from 'vitest';
import { getDebtPaymentCategoryIds } from './debtCategories';

const cat = (id, extra = {}) => ({ id, name: `Cat ${id}`, slug: null, ...extra });
const debts = [{ id: 'd1' }];

describe('getDebtPaymentCategoryIds', () => {
  it('encuentra la categoría por slug estable', () => {
    const cats = [cat('a'), cat('deuda', { slug: 'pago-deuda' })];
    expect(getDebtPaymentCategoryIds(cats, debts)).toEqual(['deuda']);
  });

  it('respaldo por nombre para cuentas antiguas sin slug (mismo criterio que Deudas y Presupuesto)', () => {
    expect(getDebtPaymentCategoryIds([cat('a'), cat('old', { name: 'Pago de Préstamos y Deudas' })], debts)).toEqual(['old']);
    expect(getDebtPaymentCategoryIds([cat('b', { name: 'Mis Préstamos' })], debts)).toEqual(['b']);
  });

  it('el slug gana sobre el nombre y solo se elige una categoría', () => {
    const cats = [cat('byName', { name: 'Pago de Préstamos y Deudas' }), cat('bySlug', { slug: 'pago-deuda' })];
    expect(getDebtPaymentCategoryIds(cats, debts)).toEqual(['bySlug']);
  });

  it('sin deudas registradas no excluye nada: quien paga préstamos a mano los conserva en la proyección', () => {
    const cats = [cat('deuda', { slug: 'pago-deuda' })];
    expect(getDebtPaymentCategoryIds(cats, [])).toEqual([]);
    expect(getDebtPaymentCategoryIds(cats, undefined)).toEqual([]);
  });

  it('sin categoría de deudas devuelve una lista vacía', () => {
    expect(getDebtPaymentCategoryIds([cat('a')], debts)).toEqual([]);
    expect(getDebtPaymentCategoryIds(undefined, debts)).toEqual([]);
  });
});
