import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ── Enums ──────────────────────────────────────────────────────────────────
// ISC-20/94: monitor type is constrained at the DB layer, not just app-layer.
export const monitorTypeEnum = pgEnum("monitor_type", [
  "http",
  "ping",
  "tcp",
  "keyword",
  "ssl",
]);

export const checkStatusEnum = pgEnum("check_status", ["up", "down"]);

// ISC-32/33/36/38/39/41/42: failure_reason enum, finalized in ISA Decisions.
export const failureReasonEnum = pgEnum("failure_reason", [
  "timeout",
  "dns",
  "tls",
  "http",
  "conn_refused",
  "keyword_missing",
  "fetch_error",
  "cert_expired",
  "cert_expiring_soon",
  "unreachable",
]);

export const incidentStatusEnum = pgEnum("incident_status", ["open", "closed"]);

// ── Accounts (ISC-1..14, ISC-99) ────────────────────────────────────────────
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 320 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // ISC-99: unique constraint at the DB layer, not just app-layer duplicate check.
  emailUnique: uniqueIndex("accounts_email_unique").on(t.email),
}));

// ── Sessions (ISC-6, ISC-8, ISC-13) ─────────────────────────────────────────
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  accountIdx: index("sessions_account_idx").on(t.accountId),
}));

// ── Password reset tokens (ISC-10, ISC-11, ISC-12, ISC-106) ────────────────
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── API tokens (ISC-85, ISC-90) ─────────────────────────────────────────────
export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  label: varchar("label", { length: 120 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// ── Monitors (ISC-15..29, ISC-92..94, ISC-98) ───────────────────────────────
export const monitors = pgTable("monitors", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  type: monitorTypeEnum("type").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  // Target fields — nullable because only relevant subsets apply per type.
  url: text("url"), // http, keyword
  hostname: varchar("hostname", { length: 255 }), // ping, tcp, ssl
  port: integer("port"), // tcp
  keyword: text("keyword"), // keyword
  intervalSeconds: integer("interval_seconds").notNull().default(60), // ISC-26 min 60
  enabled: boolean("enabled").notNull().default(true), // ISC-29
  slug: varchar("slug", { length: 80 }), // ISC-63, ISC-68, ISC-98
  published: boolean("published").notNull().default(false), // ISC-64
  webhookUrl: text("webhook_url"), // ISC-60
  sslExpiryWarningDays: integer("ssl_expiry_warning_days").notNull().default(14), // ISC-42
  nextCheckAt: timestamp("next_check_at", { withTimezone: true }).notNull().defaultNow(), // ISC-44/45
  claimedAt: timestamp("claimed_at", { withTimezone: true }), // ISC-50: scheduler CAS lock, see ISA Decisions
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  accountIdx: index("monitors_account_idx").on(t.accountId),
  nextCheckIdx: index("monitors_next_check_idx").on(t.nextCheckAt, t.enabled), // ISC-44
  slugUnique: uniqueIndex("monitors_slug_unique").on(t.slug), // ISC-98
}));

// ── Checks (ISC-30..43, append-only per ISC-95) ─────────────────────────────
// Row shape finalized in ISA Decisions after the ApertureOscillation pass:
// full future shape written now even though only HTTP checks populate it this session.
export const checks = pgTable("checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  monitorId: uuid("monitor_id").notNull().references(() => monitors.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }), // denormalized for scoped reads
  status: checkStatusEnum("status").notNull(),
  statusCode: integer("status_code"),
  responseTimeMs: integer("response_time_ms"),
  failureReason: failureReasonEnum("failure_reason"),
  certExpiresAt: timestamp("cert_expires_at", { withTimezone: true }), // ssl monitors
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // ISC-97: supports the dashboard's recent-history query without a full table scan.
  monitorCheckedIdx: index("checks_monitor_checked_idx").on(t.monitorId, t.checkedAt),
  accountIdx: index("checks_account_idx").on(t.accountId),
}));

// ── Incidents (ISC-51..62) ──────────────────────────────────────────────────
export const incidents = pgTable("incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  monitorId: uuid("monitor_id").notNull().references(() => monitors.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  status: incidentStatusEnum("status").notNull().default("open"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  durationSeconds: integer("duration_seconds"),
  // ISC-55/62 (advisor correction): alert idempotency flags — gate sends on these rather
  // than re-sending every time the transition logic runs, so a crash between commit and
  // send can't be conflated with "should never send twice."
  openNotifiedAt: timestamp("open_notified_at", { withTimezone: true }),
  closeNotifiedAt: timestamp("close_notified_at", { withTimezone: true }),
}, (t) => ({
  monitorIdx: index("incidents_monitor_idx").on(t.monitorId),
  accountIdx: index("incidents_account_idx").on(t.accountId),
  // Advisor correction: prevents two near-simultaneous check evaluations from opening two
  // incidents for the same monitor — a partial unique index, not just app-layer logic.
  oneOpenPerMonitor: uniqueIndex("incidents_one_open_per_monitor")
    .on(t.monitorId)
    .where(sql`${t.status} = 'open'`),
}));

// ── Relations ────────────────────────────────────────────────────────────
export const accountsRelations = relations(accounts, ({ many }) => ({
  monitors: many(monitors),
  sessions: many(sessions),
  apiTokens: many(apiTokens),
}));

export const monitorsRelations = relations(monitors, ({ one, many }) => ({
  account: one(accounts, { fields: [monitors.accountId], references: [accounts.id] }),
  checks: many(checks),
  incidents: many(incidents),
}));

export const checksRelations = relations(checks, ({ one }) => ({
  monitor: one(monitors, { fields: [checks.monitorId], references: [monitors.id] }),
}));

export const incidentsRelations = relations(incidents, ({ one }) => ({
  monitor: one(monitors, { fields: [incidents.monitorId], references: [monitors.id] }),
}));
