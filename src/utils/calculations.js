// FinTrack — Financial Calculations

/**
 * Gasto/monto EFECTIVO de una transacción: el monto menos el cashback que
 * generó. El cashback solo existe en gastos con tarjeta (es 0 en ingresos,
 * ahorro y deuda), así que restarlo es seguro para cualquier tipo. Refleja
 * "lo que realmente gastaste" (p. ej. RD$1000 con RD$10 de cashback = RD$990).
 * No afecta lo que debes a la tarjeta (eso usa el monto bruto en creditCards.js).
 */
export function getEffectiveAmount(t) {
  return (Number(t?.amount) || 0) - (Number(t?.cashbackEarned) || 0);
}

/**
 * Calculate the sum of effective amounts for given transactions (neto de cashback)
 */
export function sumAmounts(transactions) {
  return transactions.reduce((sum, t) => sum + getEffectiveAmount(t), 0);
}

/**
 * Calculate budget progress percentage
 */
export function calculateBudgetProgress(actual, estimated) {
  if (!estimated || estimated === 0) return 0;
  return (actual / estimated) * 100;
}

/**
 * Group transactions by category
 */
export function groupByCategory(transactions, categories) {
  const grouped = {};
  transactions.forEach(t => {
    const catId = t.categoryId;
    if (!grouped[catId]) {
      const cat = categories.find(c => c.id === catId);
      grouped[catId] = {
        category: cat || { id: catId, name: 'Sin Categoría', icon: '❓', color: '#94a3b8' },
        transactions: [],
        total: 0,
      };
    }
    grouped[catId].transactions.push(t);
    grouped[catId].total += getEffectiveAmount(t);
  });
  return Object.values(grouped);
}

/**
 * Calculate monthly amortization schedule for a debt
 */
export function calculateAmortization(balance, interestRate, monthlyPayment) {
  const schedule = [];
  let remaining = balance;
  const monthlyRate = interestRate / 100 / 12;
  let month = 0;

  while (remaining > 0 && month < 600) {
    month++;
    const interest = remaining * monthlyRate;
    const principal = Math.min(monthlyPayment - interest, remaining);

    if (principal <= 0) break; // Payment doesn't cover interest

    remaining = Math.max(0, remaining - principal);
    schedule.push({
      month,
      payment: monthlyPayment,
      principal,
      interest,
      balance: remaining,
    });
  }

  return schedule;
}

/**
 * Calculate months to reach savings goal
 */
export function monthsToGoal(currentAmount, targetAmount, monthlyContribution) {
  if (monthlyContribution <= 0) return Infinity;
  const remaining = targetAmount - currentAmount;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / monthlyContribution);
}

/**
 * Calculate projected date of completion
 */
export function projectedCompletionDate(currentAmount, targetAmount, monthlyContribution) {
  const months = monthsToGoal(currentAmount, targetAmount, monthlyContribution);
  if (months === Infinity) return null;
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return date;
}

/**
 * Fuente única de verdad del resumen mensual del presupuesto base cero.
 * Todos los montos están en moneda base (DOP); el llamante debe pasar los
 * totales de deuda ya convertidos a DOP.
 *
 * Clasifica ingresos/gastos/ahorro por el TIPO DE LA CATEGORÍA (resuelto vía
 * categoryId), igual que BudgetPage, para garantizar cifras consistentes.
 *
 * @param {Object} params
 * @param {Array}  params.monthTransactions - transacciones del mes (DOP)
 * @param {Array}  params.monthBudgets - filas de presupuesto del mes ({categoryId, estimatedAmount})
 * @param {Array}  params.categories - todas las categorías ({id, type})
 * @param {number} params.debtPlanned - pago mensual de deuda planificado (DOP)
 * @param {number} params.debtPaid - pago de deuda real del mes (DOP)
 */
export function getBudgetSummary({
  monthTransactions = [],
  monthBudgets = [],
  categories = [],
  debtPlanned = 0,
  debtPaid = 0,
  debtCategoryId = null,
}) {
  const catById = new Map(categories.map((c) => [c.id, c]));

  const estimatedByType = { income: 0, fixed_expense: 0, variable_expense: 0, savings: 0 };
  let accumulativePlan = 0;
  for (const b of monthBudgets) {
    const cat = catById.get(b.categoryId);
    if (!cat) continue;
    // La categoría de deuda se gestiona desde el módulo Deudas (su compromiso es
    // la cuota mensual, no un sobre): se excluye del estimado para no contarla
    // dos veces si el usuario le pusiera un sobre a mano.
    if (debtCategoryId && b.categoryId === debtCategoryId) continue;
    const amt = Number(b.estimatedAmount) || 0;
    if (cat.isAccumulative) { accumulativePlan += amt; continue; }
    if (cat.type in estimatedByType) estimatedByType[cat.type] += amt;
  }

  const actualByType = { income: 0, fixed_expense: 0, variable_expense: 0, savings: 0 };
  let accumulativeSpent = 0;
  let debtPaidFromTx = 0; // pago real de deuda derivado de sus transacciones
  for (const t of monthTransactions) {
    const cat = catById.get(t.categoryId);
    if (!cat) continue;
    // Gasto efectivo (neto de cashback); en ingresos/ahorro el cashback es 0.
    const amt = getEffectiveAmount(t);
    // Las transacciones de pago de deuda viven en su propia categoría: NO se
    // suman a gastosFijosReal (la deuda se compromete vía cuota), se acumulan
    // aparte como respaldo de debtPaid.
    if (debtCategoryId && t.categoryId === debtCategoryId) { debtPaidFromTx += amt; continue; }
    if (cat.isAccumulative) { accumulativeSpent += amt; continue; }
    if (cat.type in actualByType) actualByType[cat.type] += amt;
  }

  const ingresoRecibido = actualByType.income;
  const ingresoEstimado = estimatedByType.income;
  const gastosFijosPlan = estimatedByType.fixed_expense;
  const gastosVariablesPlan = estimatedByType.variable_expense;
  const ahorroPlan = estimatedByType.savings;
  const gastosFijosReal = actualByType.fixed_expense;
  const variableGastado = actualByType.variable_expense;
  const ahorroReal = actualByType.savings;
  const planDebt = Number(debtPlanned) || 0;

  // Compromiso de deuda = max(cuota planificada, pagado real). Reserva la cuota;
  // si el pago del mes la supera (sobrepago), refleja lo realmente pagado. El
  // pagado real es el explícito (debtPaid, ya convertido a DOP por el llamante)
  // o, en su defecto, el derivado de las transacciones de la categoría de deuda.
  const debtPaidEffective = (Number(debtPaid) || 0) || debtPaidFromTx;
  const debtCommitted = Math.max(planDebt, debtPaidEffective);

  // Comprometido = TODO el dinero ya asignado a un destino: sobres de gasto
  // fijo Y variable, ahorro, botes y la cuota de deuda. Coincide con el total
  // "asignado" de los sobres y hace exacta la identidad:
  //   ingresoBase = comprometido + porAsignar.
  const comprometido =
    gastosFijosPlan + gastosVariablesPlan + ahorroPlan + accumulativePlan + debtCommitted;

  // "Puedes gastar" (nivel 50/30/20 y semáforo `estado`): lo que de verdad
  // queda del ingreso recibido tras reservar fijos/ahorro/botes/deuda y
  // descontar lo YA gastado en variables. No parte de `comprometido` porque
  // este incluye el PLAN variable; aquí lo que resta es el gasto variable REAL.
  const disponible =
    ingresoRecibido - gastosFijosPlan - ahorroPlan - accumulativePlan - debtCommitted - variableGastado;
  const puedesGastar = Math.max(0, disponible);

  // Base del presupuesto: el ingreso REAL recibido manda en cuanto entra el
  // primer peso del mes; mientras no haya ingreso registrado, se respalda en el
  // estimado para que el usuario pueda presupuestar a inicio de mes. Así "por
  // asignar" deja de depender de una predicción fija que puede no cumplirse.
  const ingresoBase = ingresoRecibido > 0 ? ingresoRecibido : ingresoEstimado;

  // Lo que aún no tiene destino (y lo que se espera que quede disponible si se
  // cumple el plan): el ingreso menos todo lo comprometido.
  const porAsignar = ingresoBase - comprometido;

  // ── Vista REAL vs PRESUPUESTADO ────────────────────────────────────────────
  // REAL: solo dinero que de verdad entró/salió este mes. Ingresos en positivo;
  // gastos fijos + variables (y deuda pagada, ahorro apartado, botes) en
  // negativo. restanteReal puede ser negativo: gastaste más de lo que ganaste.
  const gastosReal = gastosFijosReal + variableGastado;
  const restanteReal =
    ingresoRecibido - gastosReal - debtPaidEffective - ahorroReal - accumulativeSpent;

  // PRESUPUESTADO: el plan puro del mes (sobres + cuota planificada de deuda),
  // sin mezclar montos reales. Espejo del bloque REAL.
  const gastosPlan = gastosFijosPlan + gastosVariablesPlan;
  const restantePlan =
    ingresoEstimado - gastosPlan - planDebt - ahorroPlan - accumulativePlan;

  let estado;
  if (ingresoRecibido === 0) estado = 'neutral';
  else if (disponible < 0) estado = 'danger';
  else if (disponible < 0.1 * ingresoRecibido) estado = 'warning';
  else estado = 'good';

  return {
    ingresoRecibido,
    ingresoEstimado,
    ingresoBase,
    gastosFijosPlan,
    gastosVariablesPlan,
    ahorroPlan,
    gastosFijosReal,
    variableGastado,
    ahorroReal,
    accumulativePlan,
    accumulativeSpent,
    debtPlanned: planDebt,
    debtPaid: debtPaidEffective,
    debtCommitted,
    comprometido,
    disponible,
    puedesGastar,
    porAsignar,
    gastosReal,
    restanteReal,
    gastosPlan,
    restantePlan,
    estado,
  };
}

/**
 * Totales de un grupo de categorías (presupuestos agrupados): suma el estimado
 * de los sobres del mes y el gasto real (neto de cashback) de las categorías
 * miembro. Sirve para ver como uno solo varios sobres que cubren lo mismo
 * (p. ej. Bravo + Grupo CCN + Supermercado = "Supermercados").
 */
export function getBudgetGroupTotals({ categoryIds = [], monthBudgets = [], monthTransactions = [] }) {
  const members = new Set(categoryIds);
  let estimated = 0;
  for (const b of monthBudgets) {
    if (members.has(b.categoryId)) estimated += Number(b.estimatedAmount) || 0;
  }
  let actual = 0;
  for (const t of monthTransactions) {
    if (members.has(t.categoryId)) actual += getEffectiveAmount(t);
  }
  return { estimated, actual, pct: calculateBudgetProgress(actual, estimated) };
}

/**
 * Regla 50/30/20 derivada de los tipos de categoría, sobre el ingreso recibido:
 *   - Necesidades (50%) = gastos fijos reales.
 *   - Gustos (30%)      = gastos variables reales.
 *   - Ahorro/Deuda (20%) = ahorro real + pago de deuda real del mes.
 * Recibe el objeto `summary` de getBudgetSummary (no recalcula transacciones).
 * Cada balde: { limit, spent, pct }. Con ingreso 0 → límites y pct en 0 (sin
 * NaN/Infinity). `pct` se acota a 0 mínimo pero puede pasar de 100 (sobregasto).
 */
export function getBuckets503020(summary = {}) {
  const income = Number(summary.ingresoRecibido) || 0;
  const pct = (spent, limit) => (limit > 0 ? Math.max(0, (spent / limit) * 100) : 0);

  const necesidadesSpent = Number(summary.gastosFijosReal) || 0;
  const gustosSpent = Number(summary.variableGastado) || 0;
  const ahorroDeudaSpent = (Number(summary.ahorroReal) || 0) + (Number(summary.debtPaid) || 0);

  const necLimit = income * 0.5;
  const gusLimit = income * 0.3;
  const ahoLimit = income * 0.2;

  return {
    income,
    necesidades: { limit: necLimit, spent: necesidadesSpent, pct: pct(necesidadesSpent, necLimit) },
    gustos: { limit: gusLimit, spent: gustosSpent, pct: pct(gustosSpent, gusLimit) },
    ahorroDeuda: { limit: ahoLimit, spent: ahorroDeudaSpent, pct: pct(ahorroDeudaSpent, ahoLimit) },
  };
}
