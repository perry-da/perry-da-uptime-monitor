import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

// ISC-119: external synthetic monitoring of the product itself.
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ data: { status: "ok", db: "connected" }, error: null }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ data: { status: "degraded", db: "unreachable" }, error: null }, { status: 200 });
  }
}
