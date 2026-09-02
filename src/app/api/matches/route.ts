import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { firstIssue, matchSchema, scoreMaxFor } from "@/lib/validation";

export const dynamic = "force-dynamic";

interface SubmissionBody {
  callsign?: unknown;
  score?: unknown;
  kills?: unknown;
  wave?: unknown;
  durationSec?: unknown;
}

/**
 * POST /api/matches {callsign, score, kills, wave, durationSec}
 * Anti-cheat sanity (PROTOCOL.md §10), then transactional ledger update.
 * Returns { player, rank, top }.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as SubmissionBody | null;
    if (!body) {
      return NextResponse.json({ error: "INVALID_PAYLOAD" }, { status: 400 });
    }
    // Coerce numeric strings defensively, then zod-validate.
    const candidate = {
      callsign:
        typeof body.callsign === "string" ? body.callsign.trim().toUpperCase() : "",
      score: Number(body.score),
      kills: Number(body.kills),
      wave: Number(body.wave),
      durationSec: Number(body.durationSec),
    };
    const parsed = matchSchema.safeParse(candidate);
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { callsign, score, kills, wave, durationSec } = parsed.data;

    const scoreMax = scoreMaxFor(kills, wave, durationSec);
    if (score > scoreMax) {
      return NextResponse.json(
        {
          error: "SANITY_CHECK_FAILED",
          reason: `SCORE ${score} EXCEEDS CEILING ${scoreMax}`,
          scoreMax,
        },
        { status: 422 },
      );
    }

    const result = await db.$transaction(async (tx) => {
      const existing = await tx.player.findUnique({ where: { callsign } });
      const player = existing
        ? await tx.player.update({
            where: { id: existing.id },
            data: {
              bestScore: Math.max(existing.bestScore, score),
              totalScore: existing.totalScore + score,
              matches: existing.matches + 1,
              kills: existing.kills + kills,
              bestWave: Math.max(existing.bestWave, wave),
            },
          })
        : await tx.player.create({
            data: {
              callsign,
              bestScore: score,
              totalScore: score,
              matches: 1,
              kills,
              bestWave: wave,
            },
          });

      await tx.match.create({
        data: { playerId: player.id, score, kills, wave, durationSec },
      });

      const ahead = await tx.player.count({
        where: { bestScore: { gt: player.bestScore } },
      });
      const top = await tx.player.findMany({
        orderBy: [
          { bestScore: "desc" },
          { bestWave: "desc" },
          { updatedAt: "asc" },
        ],
        take: 10,
        select: {
          id: true,
          callsign: true,
          bestScore: true,
          bestWave: true,
          matches: true,
          kills: true,
        },
      });

      return { player, rank: ahead + 1, top };
    });

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
