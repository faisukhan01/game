import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Season 1 ends at a fixed live-ops date (BRAND voice: no fuzzy copy). */
const SEASON_ENDS_AT = "2026-12-31T23:59:59.000Z";

export async function GET() {
  try {
    const [players, matches, top] = await Promise.all([
      db.player.count(),
      db.match.count(),
      db.player.findFirst({
        orderBy: [{ bestScore: "desc" }, { updatedAt: "asc" }],
        select: { bestScore: true },
      }),
    ]);
    return NextResponse.json({
      players,
      matches,
      topScore: top?.bestScore ?? 0,
      seasonEndsAt: SEASON_ENDS_AT,
    });
  } catch {
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
