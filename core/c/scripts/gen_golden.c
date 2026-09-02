/* VOIDSTRIPE — golden vector generator (Protocol v1).
 *
 * Emits testdata/golden/ticks.json on stdout: 5 seeds × 600 ticks,
 * checksum sampled every 60 ticks, using the "wave-survival-default"
 * scripted player (identical driver to tests/test_main.c and documented
 * in docs/PROTOCOL.md §9 so every language port can replay it).
 */
#include "voidstrike/rng.h"
#include "voidstrike/checksum.h"
#include "voidstrike/world.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

static const uint64_t SEEDS[5] = { 1337, 424242, 999, 7777, 20260924 };

static void scripted_input(const vs_world *w, vs_input *in)
{
    static const double wp[4][2] = { {400,250}, {1200,250}, {1200,650}, {400,650} };
    const vs_unit *p = &w->units[w->player_idx];
    double tx, ty, dx, dy, dl, nd = 0.0;
    const vs_unit *near_bot = NULL;
    int bots_in_nova = 0;

    memset(in, 0, sizeof(*in));
    tx = wp[(w->tick / 120) % 4][0];
    ty = wp[(w->tick / 120) % 4][1];
    dx = tx - p->pos.x; dy = ty - p->pos.y;
    dl = sqrt(dx * dx + dy * dy);
    if (dl >= 20.0) { in->move.x = dx / dl; in->move.y = dy / dl; }

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
            in->move.x = -(near_bot->pos.x - p->pos.x) / nd;
            in->move.y = -(near_bot->pos.y - p->pos.y) / nd;
        }
    } else {
        in->aim.x = 1.0; in->aim.y = 0.0;
    }
    if (bots_in_nova >= 2 && p->energy >= 55.0) in->nova = true;
}

int main(void)
{
    printf("{\n");
    printf("  \"protocol\": \"VOIDSTRIKE_SIM_V1\",\n");
    printf("  \"rules_hash\": \"0x%016llx\",\n",
           (unsigned long long)vs_rules_hash());
    printf("  \"generator\": \"core/c v1.0.0\",\n");
    printf("  \"script\": \"wave-survival-default\",\n");
    printf("  \"sampling\": \"every 60 ticks, 600 ticks per case\",\n");
    printf("  \"cases\": [\n");
    for (int c = 0; c < 5; c++) {
        vs_world w;
        vs_input in;
        printf("    {\n      \"seed\": %llu,\n      \"ticks\": 600,\n"
               "      \"checksums\": [\n",
               (unsigned long long)SEEDS[c]);
        vs_world_init(&w, SEEDS[c]);
        for (uint32_t t = 1; t <= 600; t++) {
            scripted_input(&w, &in);
            vs_world_tick(&w, &in);
            if (t % 60 == 0) {
                printf("        { \"tick\": %u, \"checksum\": \"0x%016llx\" }%s\n",
                       t, (unsigned long long)vs_world_checksum(&w),
                       t < 600 ? "," : "");
            }
        }
        printf("      ]\n    }%s\n", c < 4 ? "," : "");
    }
    printf("  ]\n}\n");
    return 0;
}
