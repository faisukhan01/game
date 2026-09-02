import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const raw = request.nextUrl.searchParams.get("limit") ?? "10";
    const parsed = Number.parseInt(raw, 10);
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 50) : 10;

    const entries = await db.player.findMany({
      orderBy: [{ bestScore: "desc" }, { bestWave: "desc" }, { updatedAt: "asc" }],
      take: limit,
      select: {
        id: true,
        callsign: true,
        bestScore: true,
        bestWave: true,
        matches: true,
        kills: true,
      },
    });

    return NextResponse.json({
      entries: entries.map((p, i) => ({ rank: i + 1, ...p })),
    });
  } catch {
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
