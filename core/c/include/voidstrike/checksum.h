/* VOIDSTRIKE — Protocol v1 · FNV-1a 64 checksums (PROTOCOL §5 step 11, §9)
 *
 * Canonical quantization for cross-language determinism:
 *   quantize(v) = (int64) floor(v * 1000.0 + 0.5)   [floor, NOT llround]
 * floor(x + 0.5) is exact and identical across C/Go/TS/C#/Python.
 */
#ifndef VOIDSTRIKE_CHECKSUM_H
#define VOIDSTRIKE_CHECKSUM_H

#include <stddef.h>
#include <stdint.h>
#include "voidstrike/types.h"

#ifdef __cplusplus
extern "C" {
#endif

uint64_t fnv1a64_bytes(const uint8_t *data, size_t len);
uint64_t fnv1a64_str(const char *s);

/* Incremental form (used by the world checksum). */
void     fnv1a64_begin(uint64_t *h);
void     fnv1a64_add(uint64_t *h, const uint8_t *data, size_t len);
void     fnv1a64_u8(uint64_t *h, uint8_t v);
void     fnv1a64_u32(uint64_t *h, uint32_t v);   /* little-endian bytes */
void     fnv1a64_i64(uint64_t *h, int64_t v);    /* little-endian bytes */

int64_t  vs_quantize(double v);

/* rules_hash = FNV1a64("VOIDSTRIKE_SIM_V1") */
uint64_t vs_rules_hash(void);

/* Checksum over units only (player + bots, array order == ascending id,
 * dead units INCLUDED), then u32 unit_count, i64 score, u32 wave,
 * u64 rules_hash. Projectiles are intentionally excluded (transient). */
uint64_t vs_world_checksum(const vs_world *w);

#ifdef __cplusplus
}
#endif
#endif /* VOIDSTRIKE_CHECKSUM_H */
