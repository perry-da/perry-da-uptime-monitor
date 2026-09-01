import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// ISC-103: secret read from env, never hardcoded.
// Prefers plain DATABASE_URL (local dev, per .env.example) but falls back to the
// Vercel Neon marketplace integration's own var names (DB_-prefixed to avoid colliding
// with a pre-existing DATABASE_URL at connect time) — DB_POSTGRES_URL specifically,
// since it's Neon's pooled/pgbouncer-compatible endpoint, the right choice for
// serverless functions that open a fresh connection per invocation rather than holding
// a long-lived pool themselves.
const connectionString =
  process.env.DATABASE_URL || process.env.DB_POSTGRES_URL || process.env.DB_DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "No database connection string found (checked DATABASE_URL, DB_POSTGRES_URL, " +
      "DB_DATABASE_URL). Copy .env.example to .env and point it at a Postgres instance " +
      "(Neon/Supabase free tier or local Postgres) — see ISA.md Decisions for why this " +
      "project targets real Postgres rather than SQLite."
  );
}

const queryClient = postgres(connectionString);
export const db = drizzle(queryClient, { schema });
