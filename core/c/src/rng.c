/* VOIDSTRIKE — Protocol v1 · splitmix64 (PROTOCOL §4). */
#include "voidstrike/rng.h"

uint64_t vs_rng_next(uint64_t *state)
{
    uint64_t z;
    *state += 0x9E3779B97F4A7C15ULL;
    z = *state;
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
    return z ^ (z >> 27);
}

double vs_rng_uniform(uint64_t *state)
{
    return (double)vs_rng_next(state) / 18446744073709551616.0; /* 2^64 */
}
