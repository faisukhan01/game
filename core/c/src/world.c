/* VOIDSTRIKE — Protocol v1 · reference deterministic simulation.
 *
 * Implements docs/PROTOCOL.md §5 tick order EXACTLY. This file is the
 * canonical reference; every other language port must reproduce it tick
 * for tick (validated via testdata/golden/ticks.json).
 *
 * RNG consumption order (PROTOCOL §4) — per tick, in order:
 *   for each bot ascending unit index:
 *     1. FSM re-evaluation (if due): orbit-sign draw on STRAFE/ATTACK entry
 *     2. PATROL waypoint re-pick: two draws (x, then y)
 *     3. fire attempt (ATTACK + LOS + ready): one jitter draw
 *   then: player fire → one spread draw (if firing)
 *   nova consumes no RNG.
 */
#include "voidstrike/world.h"
#include "voidstrike/rng.h"
#include "voidstrike/checksum.h"

#include <math.h>
#include <string.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

/* ---- static world data (PROTOCOL §2) ---- */
static const vs_aabb VS_OBSTACLES[5] = {
    { 200.0,  150.0, 220.0, 40.0},
    {1180.0,  150.0, 220.0, 40.0},
    { 200.0,  710.0, 220.0, 40.0},
    { 700.0,  420.0, 200.0, 60.0},
    {1180.0,  710.0, 220.0, 40.0}
};

static const double VS_SPAWNS[8][2] = {
    {  80.0,  80.0}, {1520.0,  80.0}, {  80.0, 820.0}, {1520.0, 820.0},
    { 800.0,  40.0}, { 800.0, 860.0}, {  40.0, 450.0}, {1560.0, 450.0}
};

/* ---- small math helpers (determinism-sensitive: keep ops literal) ---- */

static double vs_clampd(double v, double lo, double hi)
{
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
}

static double vs_len(double x, double y) { return sqrt(x * x + y * y); }

/* Normalize; zero-length input yields (0,0). */
static vs_vec2 vs_norm(double x, double y)
{
    vs_vec2 r = { 0.0, 0.0 };
    double l = vs_len(x, y);
    if (l < 1e-12) return r;
    r.x = x / l;
    r.y = y / l;
    return r;
}

/* Rotate (x,y) by angle a radians: (x·cos a − y·sin a, x·sin a + y·cos a). */
static vs_vec2 vs_rotate(double x, double y, double a)
{
    vs_vec2 r;
    double c = cos(a), s = sin(a);
    r.x = x * c - y * s;
    r.y = x * s + y * c;
    return r;
}

/* Segment (x1,y1)-(x2,y2) vs AABB — parametric slab clip.
 * Returns true if the segment intersects the box interior. */
static bool vs_seg_vs_aabb(double x1, double y1, double x2, double y2,
                           const vs_aabb *b)
{
    double dx = x2 - x1, dy = y2 - y1;
    double tmin = 0.0, tmax = 1.0;

    /* X slab */
    if (fabs(dx) < 1e-12) {
        if (x1 < b->x || x1 > b->x + b->w) return false;
    } else {
        double t1 = (b->x - x1) / dx;
        double t2 = (b->x + b->w - x1) / dx;
        if (t1 > t2) { double t = t1; t1 = t2; t2 = t; }
        tmin = tmin > t1 ? tmin : t1;
        tmax = tmax < t2 ? tmax : t2;
        if (tmin > tmax) return false;
    }
    /* Y slab */
    if (fabs(dy) < 1e-12) {
        if (y1 < b->y || y1 > b->y + b->h) return false;
    } else {
        double t1 = (b->y - y1) / dy;
        double t2 = (b->y + b->h - y1) / dy;
        if (t1 > t2) { double t = t1; t1 = t2; t2 = t; }
        tmin = tmin > t1 ? tmin : t1;
        tmax = tmax < t2 ? tmax : t2;
        if (tmin > tmax) return false;
    }
    return true;
}

static bool vs_los(const vs_world *w, vs_vec2 a, vs_vec2 bpos)
{
    uint32_t i;
    for (i = 0; i < w->obstacle_count; i++)
        if (vs_seg_vs_aabb(a.x, a.y, bpos.x, bpos.y, &w->obstacles[i]))
            return false;
    return true;
}

/* Circle (c, r) vs AABB push-out. Zeroes the axis velocity for the
 * center-inside case; removes into-wall velocity for the outside case. */
static void vs_resolve_aabb(vs_vec2 *pos, vs_vec2 *vel, double r,
                            const vs_aabb *b)
{
    double cx = vs_clampd(pos->x, b->x, b->x + b->w);
    double cy = vs_clampd(pos->y, b->y, b->y + b->h);
    double dx = pos->x - cx, dy = pos->y - cy;
    double d2 = dx * dx + dy * dy;

    if (d2 > r * r) return; /* no overlap */

    if (d2 > 1e-12) {
        double d = sqrt(d2), nx = dx / d, ny = dy / d;
        double vn;
        pos->x += nx * (r - d);
        pos->y += ny * (r - d);
        vn = vel->x * nx + vel->y * ny;
        if (vn < 0.0) {
            vel->x -= nx * vn;
            vel->y -= ny * vn;
        }
    } else {
        /* center inside the box: push to nearest edge, zero that axis */
        double dl = pos->x - b->x;
        double dr = b->x + b->w - pos->x;
        double dt = pos->y - b->y;
        double db = b->y + b->h - pos->y;
        double m = dl;
        if (dr < m) m = dr;
        if (dt < m) m = dt;
        if (db < m) m = db;
        if (m == dl)       { pos->x = b->x - r;      vel->x = 0.0; }
        else if (m == dr)  { pos->x = b->x + b->w + r; vel->x = 0.0; }
        else if (m == dt)  { pos->y = b->y - r;      vel->y = 0.0; }
        else               { pos->y = b->y + b->h + r; vel->y = 0.0; }
    }
}

void vs_resolve_aabb_public(vs_vec2 *pos, vs_vec2 *vel, double r,
                            const vs_aabb *b)
{
    vs_resolve_aabb(pos, vel, r, b);
}

static void vs_push_event(vs_world *w, vs_event e)
{
    if (w->event_count < VS_MAX_EVENTS)
        w->events[w->event_count++] = e;
}

static void vs_spawn_projectile(vs_world *w, vs_team team, uint32_t owner,
                                vs_vec2 pos, vs_vec2 dir, double speed,
                                double radius, double damage, double life)
{
    uint32_t i;
    for (i = 0; i < VS_MAX_PROJECTILES; i++) {
        vs_projectile *p = &w->projectiles[i];
        if (!p->alive) {
            p->id = w->next_proj_id++;
            p->owner = owner;
            p->alive = true;
            p->team = team;
            p->pos = pos;
            p->vel.x = dir.x * speed;
            p->vel.y = dir.y * speed;
            p->radius = radius;
            p->damage = damage;
            p->life = life;
            return;
        }
    }
    /* pool exhausted: drop silently (deterministic on all platforms) */
}

static double vs_bot_jitter_max(uint32_t wave)
{
    double deg = 12.0 - 0.5 * (double)wave;
    if (deg < 3.0) deg = 3.0;
    return deg * (M_PI / 180.0);
}

static double vs_bot_max_hp(uint32_t wave)
{
    double v = 30.0 + 8.0 * (double)wave;
    return v > 90.0 ? 90.0 : v;
}

static double vs_bot_speed(uint32_t wave)
{
    double v = 150.0 + 6.0 * (double)wave;
    return v > 240.0 ? 240.0 : v;
}

static void vs_spawn_bot(vs_world *w)
{
    vs_unit *b;
    uint32_t n;

    if (w->unit_count >= VS_MAX_UNITS) return;
    b = &w->units[w->unit_count];
    n = b->wave = w->wave;

    b->id = w->next_id++;
    b->kind = VS_ENTITY_BOT;
    b->alive = true;
    b->radius = VS_BOT_RADIUS;
    b->hp = b->max_hp = vs_bot_max_hp(n);
    b->speed = vs_bot_speed(n);
    b->pos.x = VS_SPAWNS[w->spawn_idx % 8][0];
    b->pos.y = VS_SPAWNS[w->spawn_idx % 8][1];
    w->spawn_idx++;
    b->vel.x = b->vel.y = 0.0;
    b->fire_cd = 0.0;
    b->energy = 0.0;
    b->dash_cd = 0.0;
    b->state = VS_BOT_PATROL;
    /* deterministic stagger: 0.25 * ((id % 16) / 16) */
    b->state_timer = 0.25 * ((double)(b->id % 16u) / 16.0);
    b->waypoint_timer = 0.0;
    b->waypoint.x = b->waypoint.y = 0.0;
    b->orbit_sign = 1;
    w->unit_count++;
}

void vs_world_init(vs_world *w, uint64_t seed)
{
    uint32_t i;
    memset(w, 0, sizeof(*w));
    w->rng = seed;
    w->time = 0.0;
    w->tick = 0;
    w->next_id = 0;
    w->score = 0;
    w->wave = 1;
    w->combo = 1;
    w->combo_timer = 0.0;
    w->survival_accum = 0.0;
    w->wave_pending = 3 + 2 * 1; /* wave 1 */
    w->spawn_timer = VS_BOT_SPAWN_STAGGER;
    w->spawn_idx = 0;
    w->match_over = false;
    w->obstacle_count = 5;
    for (i = 0; i < 5; i++) w->obstacles[i] = VS_OBSTACLES[i];
    w->next_proj_id = 0;
    w->proj_count = VS_MAX_PROJECTILES;
    for (i = 0; i < VS_MAX_PROJECTILES; i++) w->projectiles[i].alive = false;
    w->event_count = 0;

    /* player — always id 0, index 0 */
    w->units[0].id = w->next_id++;
    w->units[0].kind = VS_ENTITY_PLAYER;
    w->units[0].alive = true;
    w->units[0].radius = VS_PLAYER_RADIUS;
    w->units[0].hp = w->units[0].max_hp = VS_PLAYER_MAX_HP;
    w->units[0].speed = VS_PLAYER_SPEED;
    w->units[0].pos.x = VS_PLAYER_SPAWN_X;
    w->units[0].pos.y = VS_PLAYER_SPAWN_Y;
    w->units[0].vel.x = w->units[0].vel.y = 0.0;
    w->units[0].fire_cd = 0.0;
    w->units[0].energy = VS_PLAYER_ENERGY_MAX;
    w->units[0].dash_cd = 0.0;
    w->units[0].state = VS_BOT_PATROL; /* unused */
    w->units[0].wave = 0;
    w->unit_count = 1;
    w->player_idx = 0;
    w->player_alive = true;
}

int vs_alive_bots(const vs_world *w)
{
    int n = 0;
    uint32_t i;
    for (i = 0; i < w->unit_count; i++)
        if (w->units[i].kind == VS_ENTITY_BOT && w->units[i].alive) n++;
    return n;
}

/* ---- bot FSM (PROTOCOL §7) ---- */

static void vs_bot_reevaluate(vs_world *w, vs_unit *b, const vs_unit *p)
{
    vs_bot_state ns;
    double dist = vs_len(p->pos.x - b->pos.x, p->pos.y - b->pos.y);

    if (b->hp < 0.25 * b->max_hp)                      ns = VS_BOT_FLEE;
    else if (dist < 420.0 && vs_los(w, b->pos, p->pos)) ns = VS_BOT_ATTACK;
    else if (dist < 260.0)                              ns = VS_BOT_STRAFE;
    else if (dist < 520.0)                              ns = VS_BOT_CHASE;
    else                                                ns = VS_BOT_PATROL;

    if (ns != b->state) {
        b->state = ns;
        if (ns == VS_BOT_STRAFE || ns == VS_BOT_ATTACK)
            b->orbit_sign = (vs_rng_uniform(&w->rng) < 0.5) ? -1 : 1; /* 1 draw */
        if (ns == VS_BOT_PATROL)
            b->waypoint_timer = 0.0; /* forces re-pick below */
    }
}

/* FLEE: toward the corner of the nearest obstacle that is farthest from the
 * player; away from the player if no obstacles exist. */
static vs_vec2 vs_flee_dir(const vs_world *w, const vs_unit *b,
                           const vs_unit *p)
{
    uint32_t i, best = 0;
    double best_d = -1.0;
    for (i = 0; i < w->obstacle_count; i++) {
        double cx = w->obstacles[i].x + w->obstacles[i].w * 0.5;
        double cy = w->obstacles[i].y + w->obstacles[i].h * 0.5;
        double d = vs_len(cx - b->pos.x, cy - b->pos.y);
        if (d < best_d || best_d < 0.0) { best_d = d; best = i; }
    }
    if (w->obstacle_count > 0) {
        const vs_aabb *ob = &w->obstacles[best];
        static const double corners[4][2] = {
            {0, 0}, {1, 0}, {0, 1}, {1, 1}
        };
        double bx = 0.0, by = 0.0, bd = -1.0;
        int k;
        for (k = 0; k < 4; k++) {
            double cx = ob->x + corners[k][0] * ob->w;
            double cy = ob->y + corners[k][1] * ob->h;
            double dp = vs_len(cx - p->pos.x, cy - p->pos.y);
            if (dp > bd) { bd = dp; bx = cx; by = cy; }
        }
        return vs_norm(bx - b->pos.x, by - b->pos.y);
    }
    return vs_norm(b->pos.x - p->pos.x, b->pos.y - p->pos.y);
}

/* Per-tick bot update: FSM → movement dir → fire. Consumes RNG per the
 * documented order. Returns the movement direction (unit or (0,0)). */
static vs_vec2 vs_bot_update(vs_world *w, vs_unit *b, const vs_unit *p)
{
    vs_vec2 dir = { 0.0, 0.0 };
    double dist = vs_len(p->pos.x - b->pos.x, p->pos.y - b->pos.y);
    double speed_mul = 1.0;

    b->state_timer -= VS_DT;
    if (b->state_timer <= 0.0) {
        b->state_timer = 0.25;
        vs_bot_reevaluate(w, b, p);
    }

    switch (b->state) {
    case VS_BOT_PATROL: {
        double wd;
        b->waypoint_timer -= VS_DT;
        wd = vs_len(b->waypoint.x - b->pos.x, b->waypoint.y - b->pos.y);
        if (b->waypoint_timer <= 0.0 || wd < 20.0) {
            /* 2 draws: x, then y (PROTOCOL §4 order) */
            b->waypoint.x = vs_rng_uniform(&w->rng) * VS_WORLD_W;
            b->waypoint.y = vs_rng_uniform(&w->rng) * VS_WORLD_H;
            b->waypoint_timer = 4.0;
        }
        dir = vs_norm(b->waypoint.x - b->pos.x, b->waypoint.y - b->pos.y);
        break;
    }
    case VS_BOT_CHASE:
        dir = vs_norm(p->pos.x - b->pos.x, p->pos.y - b->pos.y);
        break;
    case VS_BOT_STRAFE:
    case VS_BOT_ATTACK: {
        vs_vec2 to_p = vs_norm(p->pos.x - b->pos.x, p->pos.y - b->pos.y);
        dir.x = -to_p.y * (double)b->orbit_sign;
        dir.y = to_p.x * (double)b->orbit_sign;
        speed_mul = 0.6;
        break;
    }
    case VS_BOT_FLEE:
    default:
        dir = vs_flee_dir(w, b, p);
        break;
    }

    /* fire attempt — ATTACK state, LOS clear, cooldown ready (1 draw) */
    if (b->state == VS_BOT_ATTACK && b->fire_cd <= 0.0 && w->player_alive &&
        dist < 420.0 && vs_los(w, b->pos, p->pos)) {
        vs_vec2 aim = vs_norm(p->pos.x - b->pos.x, p->pos.y - b->pos.y);
        if (aim.x == 0.0 && aim.y == 0.0) { aim.x = 1.0; aim.y = 0.0; }
        b->fire_cd = VS_BOT_FIRE_INT;
        {
            double jitter = (vs_rng_uniform(&w->rng) * 2.0 - 1.0)
                            * vs_bot_jitter_max(b->wave);
            vs_vec2 d = vs_rotate(aim.x, aim.y, jitter);
            vs_vec2 pos = { b->pos.x + d.x * (b->radius + 6.0),
                            b->pos.y + d.y * (b->radius + 6.0) };
            vs_spawn_projectile(w, VS_TEAM_BOTS, b->id, pos, d,
                                VS_BOT_P_SPEED, 4.0, VS_BOT_DAMAGE,
                                VS_BOT_P_LIFETIME);
        }
    }

    (void)speed_mul;
    return dir;
}

void vs_world_tick(vs_world *w, const vs_input *in)
{
    vs_unit *player = &w->units[w->player_idx];
    vs_vec2 aim_dir = { 1.0, 0.0 };
    vs_input zero_in;
    uint32_t i;

    memset(&zero_in, 0, sizeof(zero_in));
    if (in == NULL) in = &zero_in;

    w->event_count = 0;

    /* ---- 1. timers ---- */
    w->time += VS_DT;
    w->tick++;
    if (w->combo > 1) {
        w->combo_timer -= VS_DT;
        if (w->combo_timer <= 0.0) w->combo = 1;
    }
    for (i = 0; i < w->unit_count; i++) {
        if (w->units[i].fire_cd > 0.0)
            w->units[i].fire_cd -= VS_DT;
        if (w->units[i].dash_cd > 0.0)
            w->units[i].dash_cd -= VS_DT;
    }
    if (w->spawn_timer > 0.0)
        w->spawn_timer -= VS_DT;

    /* aim dir for the player */
    {
        double al = vs_len(in->aim.x, in->aim.y);
        if (al >= 1e-12) { aim_dir.x = in->aim.x / al; aim_dir.y = in->aim.y / al; }
    }

    /* ---- 2. movement (player first, then bots ascending) ---- */
    if (w->player_alive) {
        vs_vec2 dir = { 0.0, 0.0 };
        double ml = vs_len(in->move.x, in->move.y);
        vs_vec2 target;

        if (ml > 1.0) { dir.x = in->move.x / ml; dir.y = in->move.y / ml; }
        else if (ml > 0.0) { dir = in->move; }

        if (in->dash && player->dash_cd <= 0.0) {
            vs_vec2 dd = dir;
            player->dash_cd = VS_DASH_COOLDOWN;
            if (dd.x == 0.0 && dd.y == 0.0) dd = aim_dir;
            if (dd.x == 0.0 && dd.y == 0.0) { dd.x = 1.0; dd.y = 0.0; }
            player->vel.x += dd.x * VS_DASH_IMPULSE;
            player->vel.y += dd.y * VS_DASH_IMPULSE;
        }

        target.x = dir.x * player->speed;
        target.y = dir.y * player->speed;
        player->vel.x += (target.x - player->vel.x) * 0.2;
        player->vel.y += (target.y - player->vel.y) * 0.2;
        player->pos.x += player->vel.x * VS_DT;
        player->pos.y += player->vel.y * VS_DT;

        /* ---- 4a. player firing (1 spread draw) ---- */
        if (in->fire && player->fire_cd <= 0.0 &&
            player->energy >= VS_RIFLE_ENERGY) {
            double spread = (vs_rng_uniform(&w->rng) * 2.0 - 1.0)
                            * (VS_RIFLE_SPREAD_DEG * (M_PI / 180.0));
            vs_vec2 d = vs_rotate(aim_dir.x, aim_dir.y, spread);
            vs_vec2 pos = { player->pos.x + d.x * (player->radius + 6.0),
                            player->pos.y + d.y * (player->radius + 6.0) };
            player->energy -= VS_RIFLE_ENERGY;
            player->fire_cd = VS_RIFLE_INTERVAL;
            vs_spawn_projectile(w, VS_TEAM_PLAYER, player->id, pos, d,
                                VS_RIFLE_P_SPEED, VS_RIFLE_P_RADIUS,
                                VS_RIFLE_DAMAGE, VS_RIFLE_LIFETIME);
        }
    }

    for (i = 1; i < w->unit_count; i++) {
        vs_unit *b = &w->units[i];
        vs_vec2 dir, target;
        if (!b->alive) continue;
        dir = vs_bot_update(w, b, player);
        target.x = dir.x * b->speed * 1.0;
        target.y = dir.y * b->speed * 1.0;
        if (b->state == VS_BOT_STRAFE || b->state == VS_BOT_ATTACK) {
            target.x *= 0.6;
            target.y *= 0.6;
        }
        b->vel.x += (target.x - b->vel.x) * 0.2;
        b->vel.y += (target.y - b->vel.y) * 0.2;
        b->pos.x += b->vel.x * VS_DT;
        b->pos.y += b->vel.y * VS_DT;
    }

    /* ---- 3. world resolve: bounds + obstacles (ascending) ---- */
    for (i = 0; i < w->unit_count; i++) {
        vs_unit *u = &w->units[i];
        uint32_t k;
        if (!u->alive) continue;
        if (u->pos.x < u->radius)          { u->pos.x = u->radius; if (u->vel.x < 0.0) u->vel.x = 0.0; }
        if (u->pos.x > VS_WORLD_W - u->radius) { u->pos.x = VS_WORLD_W - u->radius; if (u->vel.x > 0.0) u->vel.x = 0.0; }
        if (u->pos.y < u->radius)          { u->pos.y = u->radius; if (u->vel.y < 0.0) u->vel.y = 0.0; }
        if (u->pos.y > VS_WORLD_H - u->radius) { u->pos.y = VS_WORLD_H - u->radius; if (u->vel.y > 0.0) u->vel.y = 0.0; }
        for (k = 0; k < w->obstacle_count; k++)
            vs_resolve_aabb(&u->pos, &u->vel, u->radius, &w->obstacles[k]);
    }

    /* ---- 5. projectiles (slot order) ---- */
    for (i = 0; i < VS_MAX_PROJECTILES; i++) {
        vs_projectile *p = &w->projectiles[i];
        uint32_t j;
        bool despawn = false;
        if (!p->alive) continue;

        p->pos.x += p->vel.x * VS_DT;
        p->pos.y += p->vel.y * VS_DT;
        p->life -= VS_DT;
        if (p->life <= 0.0) despawn = true;

        if (!despawn && (p->pos.x < 0.0 || p->pos.x > VS_WORLD_W ||
                         p->pos.y < 0.0 || p->pos.y > VS_WORLD_H))
            despawn = true;

        if (!despawn) {
            for (j = 0; j < w->obstacle_count && !despawn; j++) {
                const vs_aabb *b = &w->obstacles[j];
                double cx = vs_clampd(p->pos.x, b->x, b->x + b->w);
                double cy = vs_clampd(p->pos.y, b->y, b->y + b->h);
                double dx = p->pos.x - cx, dy = p->pos.y - cy;
                if (dx * dx + dy * dy < p->radius * p->radius)
                    despawn = true;
            }
        }

        if (!despawn) {
            if (p->team == VS_TEAM_PLAYER) {
                for (j = 1; j < w->unit_count && !despawn; j++) {
                    vs_unit *u = &w->units[j];
                    double dx, dy, rr;
                    if (!u->alive || u->kind != VS_ENTITY_BOT) continue;
                    dx = p->pos.x - u->pos.x;
                    dy = p->pos.y - u->pos.y;
                    rr = p->radius + u->radius;
                    if (dx * dx + dy * dy < rr * rr) {
                        u->hp -= p->damage;
                        vs_event ev;
                        ev.kind = VS_EV_HIT; ev.a = p->id; ev.b = u->id;
                        ev.x = p->pos.x; ev.y = p->pos.y;
                        ev.value = (int32_t)p->damage;
                        vs_push_event(w, ev);
                        despawn = true;
                    }
                }
            } else if (w->player_alive) {
                vs_unit *u = player;
                double dx = p->pos.x - u->pos.x;
                double dy = p->pos.y - u->pos.y;
                double rr = p->radius + u->radius;
                if (dx * dx + dy * dy < rr * rr) {
                    u->hp -= p->damage;
                    {
                        vs_event ev;
                        ev.kind = VS_EV_HIT; ev.a = p->id; ev.b = u->id;
                        ev.x = p->pos.x; ev.y = p->pos.y;
                        ev.value = (int32_t)p->damage;
                        vs_push_event(w, ev);
                    }
                    despawn = true;
                }
            }
        }

        if (despawn) p->alive = false;
    }

    /* ---- 6. nova (player) ---- */
    if (w->player_alive && in->nova && player->energy >= VS_NOVA_ENERGY) {
        vs_event ev;
        player->energy -= VS_NOVA_ENERGY;
        ev.kind = VS_EV_NOVA; ev.a = player->id; ev.b = 0;
        ev.x = player->pos.x; ev.y = player->pos.y; ev.value = 0;
        vs_push_event(w, ev);
        for (i = 1; i < w->unit_count; i++) {
            vs_unit *b = &w->units[i];
            double dx, dy, d;
            if (!b->alive || b->kind != VS_ENTITY_BOT) continue;
            dx = b->pos.x - player->pos.x;
            dy = b->pos.y - player->pos.y;
            d = vs_len(dx, dy);
            if (d <= VS_NOVA_RADIUS) {
                vs_vec2 n = vs_norm(dx, dy);
                b->hp -= VS_NOVA_DAMAGE;
                b->vel.x += n.x * VS_NOVA_KNOCKBACK;
                b->vel.y += n.y * VS_NOVA_KNOCKBACK;
            }
        }
    }

    /* ---- 7. deaths (ascending) ---- */
    for (i = 0; i < w->unit_count; i++) {
        vs_unit *u = &w->units[i];
        if (!u->alive) continue;
        if (u->hp <= 0.0) {
            u->alive = false;
            if (u->kind == VS_ENTITY_BOT) {
                vs_event ev;
                w->score += 100 * w->combo;
                w->combo = (w->combo >= VS_COMBO_MAX) ? VS_COMBO_MAX
                                                      : w->combo + 1;
                w->combo_timer = VS_COMBO_WINDOW;
                ev.kind = VS_EV_KILL; ev.a = u->id; ev.b = 0;
                ev.x = u->pos.x; ev.y = u->pos.y; ev.value = w->combo;
                vs_push_event(w, ev);
            } else {
                vs_event ev;
                w->player_alive = false;
                w->match_over = true;
                ev.kind = VS_EV_DEATH; ev.a = u->id; ev.b = 0;
                ev.x = u->pos.x; ev.y = u->pos.y; ev.value = 0;
                vs_push_event(w, ev);
                ev.kind = VS_EV_MATCH_END; ev.a = u->id; ev.b = 0;
                ev.x = u->pos.x; ev.y = u->pos.y;
                ev.value = (int32_t)w->wave;
                vs_push_event(w, ev);
            }
        }
    }

    /* ---- 8. regen (player) ---- */
    if (w->player_alive && player->energy < VS_PLAYER_ENERGY_MAX) {
        player->energy += VS_PLAYER_ENERGY_REGEN * VS_DT;
        if (player->energy > VS_PLAYER_ENERGY_MAX)
            player->energy = VS_PLAYER_ENERGY_MAX;
    }

    /* ---- 9. survival score ---- */
    w->survival_accum += VS_DT;
    while (w->survival_accum >= 1.0) {
        w->survival_accum -= 1.0;
        if (!w->match_over) w->score += 1;
    }

    /* ---- 10. wave director ---- */
    if (w->wave_pending > 0 && w->spawn_timer <= 0.0 && !w->match_over) {
        vs_spawn_bot(w);
        w->wave_pending--;
        w->spawn_timer = VS_BOT_SPAWN_STAGGER;
    }
    if (w->wave_pending == 0 && !w->match_over &&
        vs_alive_bots(w) == 0 && w->tick > 1) {
        vs_event ev;
        w->score += 250 + 50 * (int32_t)w->wave;
        w->wave++;
        w->wave_pending = 3 + 2 * (int32_t)w->wave;
        if (w->wave_pending > (int32_t)VS_WAVE_BOT_CAP)
            w->wave_pending = (int32_t)VS_WAVE_BOT_CAP;
        w->spawn_timer = VS_BOT_SPAWN_STAGGER;
        ev.kind = VS_EV_WAVE; ev.a = 0; ev.b = 0;
        ev.x = 0; ev.y = 0; ev.value = (int32_t)w->wave;
        vs_push_event(w, ev);
    }
}
