/* VOIDSTRIKE — Protocol v1 · world lifecycle & fixed tick. */
#ifndef VOIDSTRIKE_WORLD_H
#define VOIDSTRIKE_WORLD_H

#include <stdint.h>
#include "voidstrike/types.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Reset the world to Protocol v1 initial state:
 * player at (800, 300), wave 1 queued, score 0, seed → RNG. */
void vs_world_init(vs_world *w, uint64_t seed);

/* Advance exactly one fixed tick (dt = 1/60). `in` may be NULL
 * (equivalent to no input: no move, no fire). */
void vs_world_tick(vs_world *w, const vs_input *in);

/* Alive bot count (units with kind == BOT and alive). */
int vs_alive_bots(const vs_world *w);

/* Public collision resolver (exposed for conformance tests):
 * circle-vs-AABB push-out exactly as used inside the tick. */
void vs_resolve_aabb_public(vs_vec2 *pos, vs_vec2 *vel, double r,
                            const vs_aabb *b);

#ifdef __cplusplus
}
#endif
#endif /* VOIDSTRIKE_WORLD_H */
