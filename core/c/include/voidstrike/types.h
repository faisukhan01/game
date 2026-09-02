/* VOIDSTRIKE — Arena Protocol · Deterministic Core (Protocol v1)
 * types.h — shared simulation types.
 *
 * Single source of truth: docs/PROTOCOL.md.
 * This core is the REFERENCE implementation; all other language ports
 * (Go, TypeScript, C#, C++, Dart, Python) must reproduce it exactly.
 */
#ifndef VOIDSTRIKE_TYPES_H
#define VOIDSTRIKE_TYPES_H

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ---- World / ticking (PROTOCOL §2) ---- */
#define VS_WORLD_W 1600.0
#define VS_WORLD_H 900.0
#define VS_DT      0.016666666666666666 /* literal 1.0/60.0 — never recompute */

/* Player spawn (fixed): center column, clear of all obstacles. */
#define VS_PLAYER_SPAWN_X 800.0
#define VS_PLAYER_SPAWN_Y 300.0

/* ---- Player (PROTOCOL §3) ---- */
#define VS_PLAYER_RADIUS       14.0
#define VS_PLAYER_MAX_HP       100.0
#define VS_PLAYER_SPEED        260.0
#define VS_PLAYER_ENERGY_MAX   100.0
#define VS_PLAYER_ENERGY_REGEN 14.0
#define VS_DASH_COOLDOWN       3.0
#define VS_DASH_IMPULSE        720.0

/* ---- Pulse rifle ---- */
#define VS_RIFLE_INTERVAL   0.1
#define VS_RIFLE_P_RADIUS   4.0
#define VS_RIFLE_P_SPEED    560.0
#define VS_RIFLE_DAMAGE     10.0
#define VS_RIFLE_SPREAD_DEG 2.0
#define VS_RIFLE_LIFETIME   1.2
#define VS_RIFLE_ENERGY     2.0

/* ---- Void Nova ---- */
#define VS_NOVA_ENERGY    55.0
#define VS_NOVA_RADIUS    210.0
#define VS_NOVA_DAMAGE    48.0
#define VS_NOVA_KNOCKBACK 420.0

/* ---- Bots (wave n is 1-indexed) ---- */
#define VS_BOT_RADIUS        14.0
#define VS_BOT_DAMAGE        8.0
#define VS_BOT_FIRE_INT      0.85
#define VS_BOT_P_SPEED       480.0
#define VS_BOT_P_LIFETIME    1.6
#define VS_BOT_SPAWN_STAGGER 0.4

/* ---- Scoring ---- */
#define VS_COMBO_WINDOW 3.0
#define VS_COMBO_MAX    5

/* ---- Capacity ---- */
#define VS_MAX_UNITS       512  /* player + bots; dead units retained (id order stable) */
#define VS_MAX_PROJECTILES 256
#define VS_MAX_OBSTACLES   8
#define VS_MAX_EVENTS      256
#define VS_WAVE_BOT_CAP    63   /* per-wave spawn cap (3+2n clamped) */

typedef enum { VS_ENTITY_PLAYER = 0, VS_ENTITY_BOT = 1 } vs_unit_kind;
typedef enum {
    VS_BOT_PATROL = 0, VS_BOT_CHASE = 1, VS_BOT_STRAFE = 2,
    VS_BOT_ATTACK = 3, VS_BOT_FLEE = 4
} vs_bot_state;
typedef enum { VS_TEAM_PLAYER = 0, VS_TEAM_BOTS = 1 } vs_team;

typedef struct { double x, y; } vs_vec2;

typedef struct {
    uint32_t id;
    vs_unit_kind kind;
    bool alive;
    vs_vec2 pos, vel;
    double radius, hp, max_hp, speed;
    double fire_cd;
    double energy;      /* player only */
    double dash_cd;     /* player only */
    /* bot-only deterministic AI state */
    vs_bot_state state;
    double state_timer;      /* time until next FSM re-evaluation */
    double waypoint_timer;   /* PATROL re-pick timer */
    vs_vec2 waypoint;
    int orbit_sign;          /* ±1, drawn from shared RNG on STRAFE/ATTACK entry */
    uint32_t wave;           /* wave this bot belongs to */
} vs_unit;

typedef struct { double x, y, w, h; } vs_aabb;

/* Player input for one tick. Bots synthesize their own. */
typedef struct {
    vs_vec2 move;   /* desired move dir; normalized internally if len > 1 */
    vs_vec2 aim;    /* aim dir; treated as (1,0) when len == 0 */
    bool fire, dash, nova;
} vs_input;

typedef enum {
    VS_EV_HIT = 0, VS_EV_KILL, VS_EV_DEATH, VS_EV_WAVE, VS_EV_NOVA, VS_EV_MATCH_END
} vs_event_kind;

typedef struct {
    vs_event_kind kind;
    uint32_t a, b;      /* HIT: proj→victim · KILL: bot id · DEATH: victim id */
    double x, y;
    int32_t value;      /* damage / wave number / combo */
} vs_event;

typedef struct {
    uint32_t id, owner; /* owner = unit id that fired it */
    bool alive;
    vs_team team;
    vs_vec2 pos, vel;
    double radius, damage, life;
} vs_projectile;

typedef struct {
    /* RNG — one shared splitmix64 stream (PROTOCOL §4) */
    uint64_t rng;

    /* clock / ids */
    double   time;
    uint32_t tick;
    uint32_t next_id;

    /* score state */
    int64_t  score;
    uint32_t wave;
    int32_t  combo;             /* 1..5 */
    double   combo_timer;
    double   survival_accum;    /* fractional second accumulator */

    /* wave director */
    int32_t  wave_pending;      /* bots still queued to spawn this wave */
    double   spawn_timer;       /* countdown to next spawn */
    uint32_t spawn_idx;         /* cycles the 8 spawn points */
    bool     match_over;

    /* units (player at index 0; bots appended; never removed) */
    uint32_t unit_count;
    vs_unit  units[VS_MAX_UNITS];

    /* projectiles — fixed slots, lowest free index reused (deterministic) */
    uint32_t       proj_count;
    uint32_t       next_proj_id;
    vs_projectile  projectiles[VS_MAX_PROJECTILES];

    /* static world */
    uint32_t obstacle_count;
    vs_aabb  obstacles[VS_MAX_OBSTACLES];

    /* player bookkeeping */
    uint32_t player_idx;
    bool     player_alive;

    /* events emitted this tick (cleared at tick start) */
    uint32_t event_count;
    vs_event events[VS_MAX_EVENTS];
} vs_world;

#ifdef __cplusplus
}
#endif
#endif /* VOIDSTRIKE_TYPES_H */
