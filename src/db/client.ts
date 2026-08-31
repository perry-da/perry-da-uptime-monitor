import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// ISC-103: secret read from env, never hardcoded.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and point it at a Postgres " +
      "instance (Neon/Supabase free tier or local Postgres) — see ISA.md Decisions for why " +
      "this project targets real Postgres rather than SQLite."
  );
}

const queryClient = postgres(connectionString);
export const db = drizzle(queryClient, { schema });
