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
  "dns",
]);

// Record types tracked by a "dns" monitor. Distinct from `failureReasonEnum`'s
// `dns` member below (that one means "DNS resolution failed during an HTTP
// check" — an unrelated, pre-existing concept).
export const dnsRecordTypeEnum = pgEnum("dns_record_type", [
  "A",
  "AAAA",
  "MX",
  "TXT",
  "NS",
  "CNAME",
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

// ── DNS snapshots ────────────────────────────────────────────────────────────
// One row per record type per "dns"-type check. `values` is a JSON-stringified,
// sorted array of resolved values (sorted so semantically-identical answers in
// a different order — DNS makes no ordering guarantee — never register as a
// spurious "change"). Kept append-only, same as `checks`: the most recent row
// per (monitor_id, record_type) is the current snapshot; older rows are the
// history the diff logic in `lib/dns-tracking.ts` compares against.
export const dnsSnapshots = pgTable("dns_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  monitorId: uuid("monitor_id").notNull().references(() => monitors.id, { onDelete: "cascade" }),
  recordType: dnsRecordTypeEnum("record_type").notNull(),
  values: text("values").notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  monitorRecordCheckedIdx: index("dns_snapshots_monitor_record_checked_idx").on(
    t.monitorId,
    t.recordType,
    t.checkedAt,
  ),
}));

// ── DNS changes (the "timeline") ─────────────────────────────────────────────
// One row per detected diff between two consecutive snapshots for the same
// (monitor_id, record_type). Log-only per this feature's scope — a DNS
// record change never opens an incident or sends an alert; this table exists
// purely so a human can review what changed and when.
export const dnsChanges = pgTable("dns_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  monitorId: uuid("monitor_id").notNull().references(() => monitors.id, { onDelete: "cascade" }),
  recordType: dnsRecordTypeEnum("record_type").notNull(),
  oldValues: text("old_values"), // null for the very first snapshot ever recorded — not a "change"
  newValues: text("new_values").notNull(),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  monitorDetectedIdx: index("dns_changes_monitor_detected_idx").on(t.monitorId, t.detectedAt),
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
  dnsSnapshots: many(dnsSnapshots),
  dnsChanges: many(dnsChanges),
}));

export const checksRelations = relations(checks, ({ one }) => ({
  monitor: one(monitors, { fields: [checks.monitorId], references: [monitors.id] }),
}));

export const dnsSnapshotsRelations = relations(dnsSnapshots, ({ one }) => ({
  monitor: one(monitors, { fields: [dnsSnapshots.monitorId], references: [monitors.id] }),
}));

export const dnsChangesRelations = relations(dnsChanges, ({ one }) => ({
  monitor: one(monitors, { fields: [dnsChanges.monitorId], references: [monitors.id] }),
}));

export const incidentsRelations = relations(incidents, ({ one }) => ({
  monitor: one(monitors, { fields: [incidents.monitorId], references: [monitors.id] }),
}));
