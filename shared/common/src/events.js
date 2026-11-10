/**
 * Event catalog. Envelope `type` is the PascalCase name; the RabbitMQ routing key is
 * derived from it (ExpenseCreated -> expense.created) so consumers can bind by domain
 * (e.g. `expense.*`) or to everything (`#`, used by the audit service).
 */
export const Events = Object.freeze({
  // Identity
  UserRegistered: 'UserRegistered',
  UserLoggedIn: 'UserLoggedIn',
  UserLoggedOut: 'UserLoggedOut',
  LoginFailed: 'LoginFailed',
  PasswordResetRequested: 'PasswordResetRequested',
  PasswordChanged: 'PasswordChanged',
  UserProfileUpdated: 'UserProfileUpdated',
  // Transactions
  ExpenseCreated: 'ExpenseCreated',
  ExpenseUpdated: 'ExpenseUpdated',
  ExpenseDeleted: 'ExpenseDeleted',
  IncomeCreated: 'IncomeCreated',
  IncomeUpdated: 'IncomeUpdated',
  IncomeDeleted: 'IncomeDeleted',
  // Categories
  CategoryCreated: 'CategoryCreated',
  CategoryUpdated: 'CategoryUpdated',
  CategoryDeleted: 'CategoryDeleted',
  // Budgets
  BudgetCreated: 'BudgetCreated',
  BudgetWarning: 'BudgetWarning',
  BudgetExceeded: 'BudgetExceeded',
  // Recurring
  RecurringTransactionCreated: 'RecurringTransactionCreated',
  RecurringTransactionDue: 'RecurringTransactionDue',
  // Goals
  GoalCreated: 'GoalCreated',
  GoalContributionAdded: 'GoalContributionAdded',
  GoalMilestoneReached: 'GoalMilestoneReached',
  // Reports
  ReportRequested: 'ReportRequested',
  ReportGenerated: 'ReportGenerated',
  ReportFailed: 'ReportFailed',
  // Files
  ReceiptUploaded: 'ReceiptUploaded',
  ImportBatchReady: 'ImportBatchReady',
  FileImported: 'FileImported',
  // AI / currency
  AnomalyDetected: 'AnomalyDetected',
  ExchangeRatesUpdated: 'ExchangeRatesUpdated',
});

export function routingKeyFor(type) {
  return type.replace(/([a-z0-9])([A-Z])/g, '$1.$2').toLowerCase();
}
