import { NextResponse } from "next/server";
import { dbPath, ROOT, dataDir } from "@keyspilli/catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    cwd: process.cwd(),
    root: ROOT,
    dataDir: dataDir(),
    dbPath: dbPath(),
    keypilliDataDir: process.env.KEYSPILLI_DATA_DIR ?? null,
  });
}
