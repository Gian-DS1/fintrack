// Mapeo de strings de pantalla a claves de traducción.
// Los componentes importan desde aquí en lugar de hardcodear strings.
// Esto garantiza que TODOS los strings se traducen automáticamente.

export const SCREEN_STRINGS = {
  // Botones de acción principales
  buttons: {
    newTransaction: 'common.newTransaction',
    newGoal: 'common.newGoal',
    newDebt: 'common.newDebt',
    newCard: 'common.newCard',
    newCategory: 'common.newCategory',
    payDebt: 'common.payDebt',
    pay: 'common.pay',
    addPayment: 'creditCards.advancePayment',
  },

  // Ledger / Transacciones
  ledger: {
    title: 'nav.transactions',
    records: 'common.records',
    synchronized: 'common.synchronized',
    searchPlaceholder: 'screens.ledger.searchPlaceholder',
    allTypes: 'common.allTypes',
    allCategories: 'common.allCategories',
    from: 'common.from',
    to: 'common.to',
    income: 'common.income',
    expense: 'transactions.expense',
    variableExpense: 'transactions.variableExpense',
    fixedExpense: 'transactions.fixedExpense',
    transfer: 'transactions.transfer',
    recurringTransaction: 'screens.ledger.recurringTransaction',
    editTransaction: 'transactions.editTransaction',
    newTransaction: 'common.newTransaction',
    typeFilterAll: 'common.allTypes',
    categoryFilterAll: 'common.allCategories',
    cardFilterAll: 'common.allCards',
    transactionsUpdated: 'screens.ledger.transactionsUpdated',
  },

  // Chart labels (dashboard gráficos)
  charts: {
    income: 'common.income',
    expenses: 'common.expenses',
    last6Months: 'screens.charts.last6Months',
    noMovements: 'screens.charts.noMovements',
    balance: 'common.balance',
    estimationWithMonth: 'dashboard.estimation',
    basedOn: 'dashboard.basedOn',
    months: 'dashboard.months',
    atRisk: 'dashboard.risk',
    excellent: 'dashboard.excellent',
    netWorth: 'dashboard.netWorth',
    saved: 'savings.saved',
    debt: 'debts.debt',
    others: 'screens.charts.others',
    noExpensesThisMonth: 'screens.charts.noExpensesThisMonth',
    noMovementsIn: 'screens.charts.noMovementsIn',
    defineBudget: 'screens.charts.defineBudget',
    budgetOfMonth: 'screens.charts.budgetOfMonth',
    budgetOfMonthInfo: 'screens.charts.budgetOfMonthInfo',
    of: 'screens.charts.of',
    overBudgetMonth: 'screens.charts.overBudgetMonth',
    noSavingsOrDebts: 'screens.charts.noSavingsOrDebts',
    paceOnTrack: 'screens.charts.paceOnTrack',
    paceFast: 'screens.charts.paceFast',
    paceTick: 'screens.charts.paceTick',
    debtFree: 'screens.charts.debtFree',
    healthFactorSavings: 'screens.charts.healthFactorSavings',
    healthFactorSpending: 'screens.charts.healthFactorSpending',
    healthFactorDebt: 'screens.charts.healthFactorDebt',
  },
};
