import { z } from "zod";

/**
 * VOIDSTRIKE — shared server-side validation (callsign + match payloads).
 * Callsigns: 3–16 chars, [A-Z0-9_-], normalized to uppercase.
 */

export const CALLSIGN_PATTERN = /^[A-Z0-9_-]+$/;

export function normalizeCallsign(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().toUpperCase();
}

export const callsignSchema = z
  .string()
  .min(3, "CALLSIGN: 3-16 CHARACTERS REQUIRED")
  .max(16, "CALLSIGN: MAX 16 CHARACTERS")
  .regex(CALLSIGN_PATTERN, "CALLSIGN: A-Z, 0-9, _ AND - ONLY");

export const matchSchema = z.object({
  callsign: callsignSchema,
  score: z.number().int().min(0).max(100_000_000),
  kills: z.number().int().min(0).max(100_000),
  wave: z.number().int().min(1).max(10_000),
  durationSec: z.number().int().min(0).max(100_000),
});

export type MatchPayload = z.infer<typeof matchSchema>;

export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? issue.message : "INVALID_PAYLOAD";
}

/** PROTOCOL.md §10 — server-side score sanity. */
export function scoreMaxFor(
  kills: number,
  wave: number,
  durationSec: number,
): number {
  return 5000 + kills * 500 + wave * 400 + durationSec * 2;
}
