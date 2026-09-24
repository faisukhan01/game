/**
 * VOIDSTRIKE — splitmix64 RNG (PROTOCOL.md §4).
 * Single shared stream per world. Exact u64 arithmetic via BigInt so
 * results are bit-identical to the C reference core on every platform.
 *
 * uniform01(): next() / 2^64  — Number(bigint) is the correctly-rounded
 * double of the integer; dividing by the exact power of two 2^64 is a pure
 * exponent scaling, so the result is deterministic across engines.
 */

const GOLDEN = 0x9e3779b97f4a7c15n;
const M1 = 0xbf58476d1ce4e5b9n;
const M2 = 0x94d049bb133111ebn;
const U64_MASK = 0xffffffffffffffffn;
const TWO_POW_64 = 18446744073709551616.0; // 2^64 exactly representable

export class SplitMix64 {
  private state: bigint;

  constructor(seed: number | bigint) {
    this.state = BigInt(seed) & U64_MASK;
  }

  /** Raw u64 output. */
  nextU64(): bigint {
    this.state = (this.state + GOLDEN) & U64_MASK;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * M1) & U64_MASK;
    z = ((z ^ (z >> 27n)) * M2) & U64_MASK;
    return (z ^ (z >> 27n)) & U64_MASK;
  }

  /** Uniform double in [0, 1). */
  uniform01(): number {
    return Number(this.nextU64()) / TWO_POW_64;
  }

  /** Deterministic snapshot of the stream state (for replays / debug). */
  getState(): string {
    return this.state.toString(16).padStart(16, "0");
  }
}
