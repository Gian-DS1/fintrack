// Categorías de pagos de préstamo que NO deben alimentar los promedios de la
// proyección (esas cuotas ya se restan aparte). Mismo criterio que la sincronización
// Deudas→Transacciones (useDebtStore) y BudgetShell: slug estable `pago-deuda` y,
// como respaldo para cuentas previas al slug, el nombre. Solo aplica si el usuario
// tiene deudas registradas: quien paga préstamos a mano en esa categoría sin tenerlos
// en Deudas no los pierde de la proyección.
export function getDebtPaymentCategoryIds(categories, debts) {
  if (!debts || debts.length === 0) return [];
  const list = categories || [];
  const category = list.find((c) => c.slug === 'pago-deuda')
    || list.find((c) => c.name === 'Pago de Préstamos y Deudas' || (c.name && c.name.includes('Préstamos')));
  return category ? [category.id] : [];
}
