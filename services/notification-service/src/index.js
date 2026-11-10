import nodemailer from 'nodemailer';
import {
  Events,
  MessageBus,
  booleanString,
  configureAuth,
  createPool,
  every,
  initLogger,
  loadConfig,
  runMigrations,
  startServer,
  z,
} from '@spendwise/common';
import { buildApp } from './app.js';
import { createNotificationService } from './service.js';

const config = loadConfig(
  {
    DATABASE_URL: z.string().min(1),
    RABBITMQ_URL: z.string().min(1),
    AUTH_JWKS_URL: z.string().url(),
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().default(1025),
    SMTP_SECURE: booleanString.default('false'),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().default('SpendWise <no-reply@spendwise.local>'),
    APP_URL: z.string().url().default('http://localhost:3000'),
  },
  { SERVICE_NAME: 'notification-service', PORT: 4010 },
);
initLogger(config.SERVICE_NAME, config.LOG_LEVEL);

const pool = createPool(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
await runMigrations(pool, { dir: new URL('../migrations', import.meta.url) });
configureAuth({ jwksUrl: config.AUTH_JWKS_URL, internalToken: config.INTERNAL_API_TOKEN });

const mailer = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE,
  auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
  connectionTimeout: 5000,
});
const service = createNotificationService({ pool, mailer, config });

const handle = (event, { client }) => service.handleEvent(client, event);
const bus = new MessageBus({ url: config.RABBITMQ_URL, serviceName: config.SERVICE_NAME, pool });
await bus.start({
  handlers: Object.fromEntries(
    [
      Events.UserRegistered,
      Events.UserProfileUpdated,
      Events.PasswordResetRequested,
      Events.PasswordChanged,
      Events.UserLoggedOut,
      Events.BudgetWarning,
      Events.BudgetExceeded,
      Events.GoalMilestoneReached,
      Events.ReportGenerated,
      Events.ReportFailed,
      Events.FileImported,
      Events.AnomalyDetected,
      Events.RecurringTransactionCreated,
      Events.ExpenseCreated,
      Events.IncomeCreated,
    ].map((type) => [type, handle]),
  ),
});
every(6 * 60 * 60 * 1000, async () => {
  await bus.cleanup();
  await pool.query(`DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < now() - interval '90 days'`);
});

const app = buildApp({
  service,
  enableDocs: config.ENABLE_DOCS,
  readiness: { database: () => pool.query('SELECT 1'), broker: () => bus.isReady() },
});
startServer({ app, port: config.PORT, onShutdown: [() => bus.close(), () => pool.end()] });
