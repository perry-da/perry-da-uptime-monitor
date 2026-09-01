import { defineConfig } from "drizzle-kit";

// Migrations/DDL prefer the unpooled/direct connection when available (Neon's Vercel
// integration exposes both) — pgbouncer transaction-mode pooling can be unreliable for
// certain DDL/advisory-lock operations drizzle-kit relies on. Falls back to the pooled
// URL or plain DATABASE_URL if that's all that's set (e.g. local dev).
const url =
  process.env.DATABASE_URL ||
  process.env.DB_DATABASE_URL_UNPOOLED ||
  process.env.DB_POSTGRES_URL_NON_POOLING ||
  process.env.DB_POSTGRES_URL ||
  process.env.DB_DATABASE_URL ||
  "";

if (!url) {
  // drizzle-kit CLI is fine to fail loudly here — this only runs interactively.
  console.warn("No database URL found — drizzle-kit commands will fail until .env is configured.");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
});
