/* VOIDSTRIKE — Protocol v1 · FNV-1a 64 checksums. */
#include "voidstrike/checksum.h"

#include <math.h>
#include <string.h>

#define FNV_OFFSET 0xcbf29ce484222325ULL
#define FNV_PRIME  0x100000001b3ULL

static void fnv_mix(uint64_t *h, const uint8_t *data, size_t len)
{
    size_t i;
    for (i = 0; i < len; i++) {
        *h ^= data[i];
        *h *= FNV_PRIME;
    }
}

uint64_t fnv1a64_bytes(const uint8_t *data, size_t len)
{
    uint64_t h = FNV_OFFSET;
    fnv_mix(&h, data, len);
    return h;
}

uint64_t fnv1a64_str(const char *s)
{
    return fnv1a64_bytes((const uint8_t *)s, strlen(s));
}

void fnv1a64_begin(uint64_t *h) { *h = FNV_OFFSET; }

void fnv1a64_add(uint64_t *h, const uint8_t *data, size_t len) { fnv_mix(h, data, len); }

void fnv1a64_u8(uint64_t *h, uint8_t v) { fnv_mix(h, &v, 1); }

void fnv1a64_u32(uint64_t *h, uint32_t v)
{
    uint8_t b[4];
    b[0] = (uint8_t)(v & 0xFF);
    b[1] = (uint8_t)((v >> 8) & 0xFF);
    b[2] = (uint8_t)((v >> 16) & 0xFF);
    b[3] = (uint8_t)((v >> 24) & 0xFF);
    fnv_mix(h, b, 4);
}

void fnv1a64_i64(uint64_t *h, int64_t v)
{
    uint64_t u = (uint64_t)v;
    uint8_t b[8];
    int i;
    for (i = 0; i < 8; i++)
        b[i] = (uint8_t)((u >> (8 * i)) & 0xFF);
    fnv_mix(h, b, 8);
}

int64_t vs_quantize(double v)
{
    return (int64_t)floor(v * 1000.0 + 0.5);
}

uint64_t vs_rules_hash(void)
{
    return fnv1a64_str("VOIDSTRIKE_SIM_V1");
}

uint64_t vs_world_checksum(const vs_world *w)
{
    uint64_t h;
    uint32_t i;

    fnv1a64_begin(&h);
    for (i = 0; i < w->unit_count; i++) {
        const vs_unit *u = &w->units[i];
        fnv1a64_u32(&h, u->id);
        fnv1a64_i64(&h, vs_quantize(u->pos.x));
        fnv1a64_i64(&h, vs_quantize(u->pos.y));
        fnv1a64_i64(&h, vs_quantize(u->vel.x));
        fnv1a64_i64(&h, vs_quantize(u->vel.y));
        fnv1a64_i64(&h, vs_quantize(u->hp));
        fnv1a64_u8(&h, (uint8_t)u->kind);
        fnv1a64_u8(&h, u->alive ? 1u : 0u);
    }
    fnv1a64_u32(&h, w->unit_count);
    fnv1a64_i64(&h, w->score);
    fnv1a64_u32(&h, w->wave);
    fnv1a64_i64(&h, (int64_t)vs_rules_hash());
    return h;
}
