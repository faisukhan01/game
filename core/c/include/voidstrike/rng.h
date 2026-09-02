/* VOIDSTRIKE — Protocol v1 · splitmix64 RNG (PROTOCOL §4)
 * The ONLY random source permitted in the deterministic path.
 */
#ifndef VOIDSTRIKE_RNG_H
#define VOIDSTRIKE_RNG_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Advance the stream and return the raw 64-bit output. */
uint64_t vs_rng_next(uint64_t *state);

/* Uniform double in [0, 1): next() / 2^64 (exact per PROTOCOL §4). */
double vs_rng_uniform(uint64_t *state);

#ifdef __cplusplus
}
#endif
#endif /* VOIDSTRIKE_RNG_H */
