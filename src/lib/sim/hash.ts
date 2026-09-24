/**
 * VOIDSTRIKE — FNV-1a 64-bit hashing (PROTOCOL.md §1).
 * Used for rules_hash and per-tick state checksums.
 * Arithmetic on BigInt to guarantee exact u64 wraparound semantics.
 */

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const U64_MASK = 0xffffffffffffffffn;

const encoder =
  typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

function utf8Bytes(input: string): Uint8Array {
  if (encoder) return encoder.encode(input);
  // Fallback (non-browser pure envs)
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}

export function fnv1a64(input: string): bigint {
  let h = FNV_OFFSET;
  const bytes = utf8Bytes(input);
  for (let i = 0; i < bytes.length; i++) {
    h = h ^ BigInt(bytes[i]);
    h = (h * FNV_PRIME) & U64_MASK;
  }
  return h;
}

export function fnv1a64Hex(input: string): string {
  return "0x" + fnv1a64(input).toString(16).padStart(16, "0");
}

/** rules_hash = FNV1a64("VOIDSTRIKE_SIM_V1") — PROTOCOL.md §1. */
export const RULES_HASH = fnv1a64Hex("VOIDSTRIKE_SIM_V1");
