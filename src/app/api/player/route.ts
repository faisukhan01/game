import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  callsignSchema,
  firstIssue,
  normalizeCallsign,
} from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * POST /api/player {callsign}
 * Validates + upserts a striker profile. 400 on invalid callsign.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const callsign = normalizeCallsign(
      body && typeof body === "object"
        ? (body as Record<string, unknown>).callsign
        : null,
    );
    const parsed = callsignSchema.safeParse(callsign);
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }

    const player = await db.player.upsert({
      where: { callsign: parsed.data },
      create: { callsign: parsed.data },
      update: {},
    });

    return NextResponse.json(player);
  } catch {
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
