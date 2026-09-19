/* VOIDSTRIPE — core conformance test suite.
 *
 * RNG/checksum expected values were computed independently with Python
 * bignum arithmetic (not derived from this C code) — a true cross-check.
 */
#include "voidstrike/rng.h"
#include "voidstrike/checksum.h"
#include "voidstrike/world.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static int failures = 0;
static int checks = 0;

#define CHECK(cond, msg)                                                  \
    do {                                                                  \
        checks++;                                                         \
        if (!(cond)) {                                                    \
            failures++;                                                   \
            printf("  FAIL: %s (line %d)\n", msg, __LINE__);              \
        }                                                                 \
    } while (0)

#define CHECK_EQ_U64(a, b, msg)                                           \
    do {                                                                  \
        checks++;                                                         \
        if ((a) != (b)) {                                                 \
            failures++;                                                   \
            printf("  FAIL: %s — expected 0x%016llx got 0x%016llx\n",     \
                   msg, (unsigned long long)(b), (unsigned long long)(a));\
        }                                                                 \
    } while (0)

/* ------------------------------------------------------------------ */
static void test_rng(void)
{
    uint64_t s = 0;
    printf("rng: splitmix64 known-answer (independent Python reference)\n");
    CHECK_EQ_U64(vs_rng_next(&s), 0xe220a824fb499ac9ULL, "sm64 seed0 out1");
    CHECK_EQ_U64(vs_rng_next(&s), 0x6e789e67b25b946fULL, "sm64 seed0 out2");
    CHECK_EQ_U64(vs_rng_next(&s), 0x06c45d18550a5c6fULL, "sm64 seed0 out3");

    s = 1337;
    CHECK_EQ_U64(vs_rng_next(&s), 0xb6a8a9a4ab8ec520ULL, "sm64 seed1337 out1");
    CHECK_EQ_U64(vs_rng_next(&s), 0xcb7f28539ecd5c02ULL, "sm64 seed1337 out2");
    CHECK_EQ_U64(vs_rng_next(&s), 0x3440fcc9b4964b23ULL, "sm64 seed1337 out3");

    /* uniform01 within [0,1) over a sample */
    s = 42;
    for (int i = 0; i < 10000; i++) {
        double u = vs_rng_uniform(&s);
        if (!(u >= 0.0 && u < 1.0)) { checks++; failures++; printf("  FAIL: uniform out of range\n"); break; }
        checks++;
    }
}

static void test_checksum(void)
{
    printf("checksum: FNV-1a 64 canonical vectors\n");
    CHECK_EQ_U64(fnv1a64_str(""), 0xcbf29ce484222325ULL, "fnv empty");
    CHECK_EQ_U64(fnv1a64_str("a"), 0xaf63dc4c8601ec8cULL, "fnv 'a'");
    CHECK_EQ_U64(fnv1a64_str("foobar"), 0x85944171f73967e8ULL, "fnv 'foobar'");
    CHECK_EQ_U64(vs_rules_hash(), 0xbfb4742570daa8fbULL, "rules_hash");

    CHECK(vs_quantize(1.2345) == 1235, "quantize round-half-up");
    CHECK(vs_quantize(-1.2345) == -1234, "quantize negative half");
    CHECK(vs_quantize(0.0) == 0, "quantize zero");
}

/* ------------------------------------------------------------------ */
/* Scripted player — "wave-survival-default" (see README + PROTOCOL §9). */
static void scripted_input(const vs_world *w, vs_input *in)
{
    static const double wp[4][2] = { {400,250}, {1200,250}, {1200,650}, {400,650} };
    const vs_unit *p = &w->units[w->player_idx];
    double tx, ty, dx, dy, dl, nd = 0.0;
    const vs_unit *near_bot = NULL;
    int bots_in_nova = 0;

    memset(in, 0, sizeof(*in));

    /* movement: waypoints cycle every 120 ticks */
    tx = wp[(w->tick / 120) % 4][0];
    ty = wp[(w->tick / 120) % 4][1];
    dx = tx - p->pos.x; dy = ty - p->pos.y;
    dl = sqrt(dx * dx + dy * dy);
    if (dl >= 20.0) { in->move.x = dx / dl; in->move.y = dy / dl; }

    /* aim at nearest alive bot */
    for (uint32_t i = 1; i < w->unit_count; i++) {
        const vs_unit *b = &w->units[i];
        if (b->kind != VS_ENTITY_BOT || !b->alive) continue;
        double d = sqrt((b->pos.x - p->pos.x) * (b->pos.x - p->pos.x)
                      + (b->pos.y - p->pos.y) * (b->pos.y - p->pos.y));
        if (!near_bot || d < nd) { near_bot = b; nd = d; }
        if (d <= 210.0) bots_in_nova++;
    }

    if (near_bot) {
        in->aim.x = (near_bot->pos.x - p->pos.x) / nd;
        in->aim.y = (near_bot->pos.y - p->pos.y) / nd;
        in->fire = true;
        if (nd < 150.0 && p->dash_cd <= 0.0) {
            in->dash = true;
            in->move.x = -(near_bot->pos.x - p->pos.x) / nd; /* away */
            in->move.y = -(near_bot->pos.y - p->pos.y) / nd;
        }
    } else {
        in->aim.x = 1.0; in->aim.y = 0.0;
    }
    if (bots_in_nova >= 2 && p->energy >= 55.0) in->nova = true;
}

static void run_scripted(uint64_t seed, uint32_t ticks, uint64_t *out60)
{
    vs_world w;
    int n = 0;
    vs_world_init(&w, seed);
    for (uint32_t t = 1; t <= ticks; t++) {
        vs_input in;
        scripted_input(&w, &in);
        vs_world_tick(&w, &in);
        if (t % 60 == 0 && out60) out60[n++] = vs_world_checksum(&w);
    }
}

static void test_determinism(void)
{
    uint64_t a[10], b[10], c[10];
    printf("determinism: identical runs → identical checksum streams\n");
    run_scripted(1337, 600, a);
    run_scripted(1337, 600, b);
    run_scripted(424242, 600, c);
    CHECK(memcmp(a, b, sizeof(a)) == 0, "same seed → same checksums");
    CHECK(memcmp(a, c, sizeof(a)) != 0, "different seed → different stream");

    /* world rule smoke: waves progress, score accumulates */
    vs_world w;
    vs_world_init(&w, 1337);
    for (uint32_t t = 0; t < 3600; t++) {
        vs_input in;
        scripted_input(&w, &in);
        vs_world_tick(&w, &in);
    }
    printf("  60s run: wave=%u score=%lld kills_registered=%u units=%u\n",
           w.wave, (long long)w.score, w.tick, w.unit_count);
    CHECK(w.wave >= 3, "wave >= 3 after 60s scripted run");
    CHECK(w.score > 0, "score accumulates");
    CHECK(w.unit_count <= VS_MAX_UNITS, "unit cap respected");
}

static void test_collision(void)
{
    vs_vec2 pos = { 800.0, 440.0 }, vel = { 0.0, 260.0 }; /* falling into box 4 */
    vs_aabb box = { 700.0, 420.0, 200.0, 60.0 };

    vs_resolve_aabb_public(&pos, &vel, 14.0, &box);
    CHECK(pos.y <= 420.0 - 14.0 + 1e-9, "pushed out above box");
    CHECK(vel.y <= 0.0, "into-wall velocity removed");

    /* center-inside case */
    vs_vec2 p2 = { 800.0, 450.0 }, v2 = { 10.0, 0.0 };
    vs_resolve_aabb_public(&p2, &v2, 14.0, &box);
    CHECK(p2.y == 420.0 - 14.0 || p2.y == 480.0 + 14.0,
          "inside case pushes to nearest edge");

    /* bounds clamp via world tick (1 tick of hard-right movement) */
    vs_world w;
    vs_world_init(&w, 1);
    for (int t = 0; t < 400; t++) {
        vs_input in;
        memset(&in, 0, sizeof(in));
        in.move.x = 1.0; /* run right into the wall */
        vs_world_tick(&w, &in);
    }
    CHECK(w.units[0].pos.x <= 1600.0 - 14.0, "world bound clamps player");
}

static void test_perf(void)
{
    clock_t t0 = clock();
    run_scripted(20260924, 600, NULL);
    double secs = (double)(clock() - t0) / CLOCKS_PER_SEC;
    printf("perf: 600 scripted ticks in %.3fs\n", secs);
    CHECK(secs < 5.0, "600 ticks under 5s");
}

int main(void)
{
    printf("VOIDSTRIKE core conformance tests — Protocol v1\n");
    test_rng();
    test_checksum();
    test_determinism();
    test_collision();
    test_perf();
    printf("\n%d checks, %d failures\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
