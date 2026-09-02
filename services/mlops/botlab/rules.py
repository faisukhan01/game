"""VOIDSTRIKE Protocol v1 deterministic simulation (single source of truth: docs/PROTOCOL.md).

This module mirrors the live game simulation exactly:

* World 1600x900, 60 Hz, ``dt = 0.016666666666666666`` (precomputed literal, never recomputed).
* A single ``splitmix64`` stream per world, consumed in the fixed order
  "bot AI in ascending entity id, then effect jitter" (PROTOCOL §4).
* Fixed 11-step tick order (PROTOCOL §5).
* Deterministic wave-survival bot FSM (PROTOCOL §7).
* Per-tick FNV1a64 world checksum (PROTOCOL §1/§5 step 11).

Arithmetic is plain Python ``float`` (IEEE-754 binary64) in a fixed order; the only
transcendentals used are ``math.cos``/``math.sin`` (rotation), exactly as permitted by §4.

v1-clarifications (ambiguities resolved here and recorded for the other engines;
each is deterministic and documented in services/mlops/README.md):

* Player spawn for wave-survival is ``(800.0, 260.0)`` (clear of all obstacles; the
  geometric center (800, 450) is inside the center AABB).
* Entity ids (u32, ascending, player == 0) are shared by bots AND projectiles.
* Player/bot positions are clamped to the world bounds after obstacle push-out
  (projectiles despawn at bounds per §5 step 5).
* Checksum byte layout: see :func:`compute_checksum` (header + per-entity records,
  ``id`` as u32 LE, coordinates/velocities/hp as i64 LE of ``round(v * 1000)`` with
  round-half-away-from-zero, matching C ``lround``).
* Bot FSM movement details: ATTACK orbits the player at 0.6x speed (same as STRAFE);
  FLEE blends the away-vector with the vector toward the nearest obstacle corner;
  PATROL re-picks a random waypoint every 4 s (uniform over the whole arena, 2 RNG
  draws) and idles within 5 u of it. Bots fire only in ATTACK.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Iterator, List, Optional, Sequence, Tuple

__all__ = [
    "DT",
    "OBSTACLES",
    "SPAWN_POINTS",
    "PLAYER_SPAWN",
    "RawInput",
    "SplitMix64",
    "ScriptedPolicy",
    "World",
    "compute_checksum",
    "fnv1a64",
    "rules_hash",
    "bot_hp",
    "bot_speed",
    "bot_aim_jitter_deg",
    "bot_count",
    "wave_bonus",
    "BOT_ATTACK",
    "BOT_CHASE",
    "BOT_FLEE",
    "BOT_PATROL",
    "BOT_STRAFE",
]

# ---------------------------------------------------------------------------
# World & ticking (PROTOCOL §2)
# ---------------------------------------------------------------------------

WORLD_W: float = 1600.0
WORLD_H: float = 900.0
TICK_RATE: int = 60
DT: float = 0.016666666666666666  # 1.0/60.0 precomputed literal — NEVER recompute

RULES_SEED_STRING: str = "VOIDSTRIKE_SIM_V1"

#: Static AABBs as (x, y, w, h).
OBSTACLES: Tuple[Tuple[float, float, float, float], ...] = (
    (200.0, 150.0, 220.0, 40.0),
    (1180.0, 150.0, 220.0, 40.0),
    (200.0, 710.0, 220.0, 40.0),
    (700.0, 420.0, 200.0, 60.0),
    (1180.0, 710.0, 220.0, 40.0),
)

#: 8 fixed edge spawn points.
SPAWN_POINTS: Tuple[Tuple[float, float], ...] = (
    (80.0, 80.0),
    (1520.0, 80.0),
    (80.0, 820.0),
    (1520.0, 820.0),
    (800.0, 40.0),
    (800.0, 860.0),
    (40.0, 450.0),
    (1560.0, 450.0),
)

#: v1-clarification: wave-survival player start (clear of every AABB).
PLAYER_SPAWN: Tuple[float, float] = (800.0, 260.0)

# ---------------------------------------------------------------------------
# Constants (PROTOCOL §3 — authoritative, do not edit)
# ---------------------------------------------------------------------------

PLAYER_RADIUS: float = 14.0
PLAYER_MAX_HP: float = 100.0
PLAYER_SPEED: float = 260.0
PLAYER_ENERGY_MAX: float = 100.0
PLAYER_ENERGY_REGEN: float = 14.0
PLAYER_DASH_COOLDOWN: float = 3.0
PLAYER_DASH_IMPULSE: float = 720.0

RIFLE_FIRE_INTERVAL: float = 0.1
RIFLE_PROJ_RADIUS: float = 4.0
RIFLE_PROJ_SPEED: float = 560.0
RIFLE_DAMAGE: float = 10.0
RIFLE_SPREAD_DEG: float = 2.0
RIFLE_LIFETIME: float = 1.2
RIFLE_ENERGY_COST: float = 2.0

NOVA_ENERGY_COST: float = 55.0
NOVA_RADIUS: float = 210.0
NOVA_DAMAGE: float = 48.0
NOVA_KNOCKBACK: float = 420.0

BOT_RADIUS: float = 14.0
BOT_DAMAGE: float = 8.0
BOT_FIRE_INTERVAL: float = 0.85
BOT_PROJ_SPEED: float = 480.0
BOT_PROJ_LIFETIME: float = 1.6
BOT_SPAWN_STAGGER: float = 0.4

COMBO_WINDOW: float = 3.0
COMBO_MAX: int = 5
SURVIVAL_SCORE_PER_SEC: int = 1

BOT_FSM_INTERVAL: float = 0.25
BOT_PATROL_INTERVAL: float = 4.0
#: Bots idle when closer than this to their patrol waypoint (u).
BOT_PATROL_ARRIVE: float = 5.0


def bot_hp(wave: int) -> float:
    """Wave-n bot hp: ``min(30 + 8n, 90)``."""
    return min(30.0 + 8.0 * wave, 90.0)


def bot_speed(wave: int) -> float:
    """Wave-n bot speed: ``min(150 + 6n, 240)``."""
    return min(150.0 + 6.0 * wave, 240.0)


def bot_aim_jitter_deg(wave: int) -> float:
    """Wave-n bot aim jitter: ``max(3.0, 12.0 - 0.5n)`` degrees."""
    return max(3.0, 12.0 - 0.5 * wave)


def bot_count(wave: int) -> int:
    """Wave-n bot count: ``3 + 2n``."""
    return 3 + 2 * wave


def wave_bonus(wave: int) -> int:
    """Wave-n clear bonus: ``250 + 50n``."""
    return 250 + 50 * wave


# Bot FSM states (PROTOCOL §7).
BOT_PATROL = "PATROL"
BOT_CHASE = "CHASE"
BOT_STRAFE = "STRAFE"
BOT_ATTACK = "ATTACK"
BOT_FLEE = "FLEE"


# ---------------------------------------------------------------------------
# Randomness — splitmix64 (PROTOCOL §4)
# ---------------------------------------------------------------------------

_U64_MASK = (1 << 64) - 1
_SPLITMIX_GAMMA = 0x9E3779B97F4A7C15
_SPLITMIX_M1 = 0xBF58476D1CE4E5B9
_SPLITMIX_M2 = 0x94D049BB133111EB
_TWO_POW_64 = float(1 << 64)


class SplitMix64:
    """splitmix64 PRNG — the single shared randomness stream of a world.

    State is a u64 initialised from ``seed`` (masked to 64 bits). ``uniform01``
    returns ``next() / 2**64`` in float64.
    """

    __slots__ = ("state",)

    def __init__(self, seed: int) -> None:
        self.state: int = int(seed) & _U64_MASK

    def next_u64(self) -> int:
        """Advance the stream and return the next 64-bit value."""
        self.state = (self.state + _SPLITMIX_GAMMA) & _U64_MASK
        z = self.state
        z = ((z ^ (z >> 30)) * _SPLITMIX_M1) & _U64_MASK
        z = ((z ^ (z >> 27)) * _SPLITMIX_M2) & _U64_MASK
        return z ^ (z >> 27)

    def uniform01(self) -> float:
        """Next value as float64 in ``[0, 1)``."""
        return self.next_u64() / _TWO_POW_64


# ---------------------------------------------------------------------------
# FNV1a64 checksum (PROTOCOL §1)
# ---------------------------------------------------------------------------

_FNV_OFFSET_BASIS = 0xcbf29ce484222325
_FNV_PRIME = 0x100000001B3


def fnv1a64(data: bytes) -> int:
    """64-bit FNV-1a hash of ``data`` (byte-exact, u64 result)."""
    h = _FNV_OFFSET_BASIS
    for byte in data:
        h ^= byte
        h = (h * _FNV_PRIME) & _U64_MASK
    return h


def rules_hash() -> int:
    """``FNV1a64("VOIDSTRIKE_SIM_V1")`` — the Protocol v1 rules hash."""
    return fnv1a64(RULES_SEED_STRING.encode("ascii"))


def rules_hash_hex() -> str:
    """Rules hash formatted ``0x…`` (16 hex digits), as carried in manifests."""
    return f"0x{rules_hash():016x}"


def _round_milli(v: float) -> int:
    """Round to thousandths, half away from zero (matches C ``lround``)."""
    if v >= 0.0:
        return int(math.floor(v * 1000.0 + 0.5))
    return -int(math.floor(-v * 1000.0 + 0.5))


def compute_checksum(world: "World") -> int:
    """Per-tick world checksum (PROTOCOL §5 step 11).

    Byte layout (documented for cross-engine conformance with ``core/c``):

    * ``b"VS1"`` magic (3 bytes)
    * tick — u64 LE
    * score — i64 LE
    * wave — u32 LE
    * entity count — u32 LE
    * per entity (player, then bots ascending id, then projectiles ascending id):
      kind byte (0 player / 1 bot / 2 projectile), ``id`` u32 LE, then ``x, y, vx, vy, hp``
      each as i64 LE of ``round(v * 1000)`` (round-half-away-from-zero; projectiles carry hp=0).

    The digest is ``FNV1a64`` over the concatenated bytes.
    """
    buf = bytearray(b"VS1")
    buf += world.tick.to_bytes(8, "little", signed=False)
    buf += int(world.score).to_bytes(8, "little", signed=True)
    buf += world.wave.to_bytes(4, "little", signed=False)
    entities: List[Tuple[int, float, float, float, float, float, int]] = [
        (0, world.player.x, world.player.y, world.player.vx, world.player.vy,
         world.player.hp, world.player.id)
    ]
    for bot in world.bots:
        entities.append((1, bot.x, bot.y, bot.vx, bot.vy, bot.hp, bot.id))
    for proj in world.projectiles:
        entities.append((2, proj.x, proj.y, proj.vx, proj.vy, proj.hp, proj.id))
    buf += len(entities).to_bytes(4, "little", signed=False)
    for kind, x, y, vx, vy, hp, eid in entities:
        buf += kind.to_bytes(1, "little", signed=False)
        buf += eid.to_bytes(4, "little", signed=False)
        for v in (x, y, vx, vy, hp):
            buf += _round_milli(v).to_bytes(8, "little", signed=True)
    return fnv1a64(bytes(buf))


# ---------------------------------------------------------------------------
# Small deterministic math helpers (only +,-,*,/,sqrt,abs,floor,cos,sin)
# ---------------------------------------------------------------------------

def normalize(v: Tuple[float, float]) -> Optional[Tuple[float, float]]:
    """Unit vector of ``v`` or ``None`` when ``v`` is the zero vector."""
    d = math.sqrt(v[0] * v[0] + v[1] * v[1])
    if d == 0.0:
        return None
    return (v[0] / d, v[1] / d)


def rotate(v: Tuple[float, float], angle: float) -> Tuple[float, float]:
    """Rotate ``(x, y)`` by ``angle`` rad (PROTOCOL §4 rotation formula)."""
    c = math.cos(angle)
    s = math.sin(angle)
    return (v[0] * c - v[1] * s, v[0] * s + v[1] * c)


def clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else (hi if v > hi else v)


def segment_hits_aabb(
    x1: float, y1: float, x2: float, y2: float,
    bx: float, by: float, bw: float, bh: float,
) -> bool:
    """Clamp-based (Liang-Barsky) segment vs AABB intersection test — no trig."""
    dx = x2 - x1
    dy = y2 - y1
    t0 = 0.0
    t1 = 1.0
    for p, q in (
        (-dx, x1 - bx),
        (dx, bx + bw - x1),
        (-dy, y1 - by),
        (dy, by + bh - y1),
    ):
        if p == 0.0:
            if q < 0.0:
                return False
        else:
            r = q / p
            if p < 0.0:
                if r > t1:
                    return False
                if r > t0:
                    t0 = r
            else:
                if r < t0:
                    return False
                if r < t1:
                    t1 = r
    return True


def los_clear(ax: float, ay: float, bx: float, by: float) -> bool:
    """Line of sight between two points: segment misses all 5 AABBs."""
    for ox, oy, ow, oh in OBSTACLES:
        if segment_hits_aabb(ax, ay, bx, by, ox, oy, ow, oh):
            return False
    return True


def resolve_obstacles(entity: "Entity") -> None:
    """Circle-vs-AABB push-out (PROTOCOL §5 step 3).

    Center is clamped to the box; when the (outside) distance is below the radius
    the entity is pushed back along the box normal. When the center is inside the
    box it is pushed to the nearest edge (tie order: left, right, bottom, top) and
    that axis' velocity is zeroed.
    """
    r = entity.radius
    for bx, by, bw, bh in OBSTACLES:
        cx = clamp(entity.x, bx, bx + bw)
        cy = clamp(entity.y, by, by + bh)
        dx = entity.x - cx
        dy = entity.y - cy
        if dx == 0.0 and dy == 0.0:
            # Center inside the box: push to nearest edge, zero that axis vel.
            dist_l = entity.x - bx
            dist_r = bx + bw - entity.x
            dist_b = entity.y - by
            dist_t = by + bh - entity.y
            m = min(dist_l, dist_r, dist_b, dist_t)
            if m == dist_l:
                entity.x = bx - r
                entity.vx = 0.0
            elif m == dist_r:
                entity.x = bx + bw + r
                entity.vx = 0.0
            elif m == dist_b:
                entity.y = by - r
                entity.vy = 0.0
            else:
                entity.y = by + bh + r
                entity.vy = 0.0
        else:
            d2 = dx * dx + dy * dy
            if d2 < r * r:
                d = math.sqrt(d2)
                entity.x = cx + (dx / d) * r
                entity.y = cy + (dy / d) * r


def clamp_world(entity: "Entity") -> None:
    """v1-clarification: keep living entities inside the arena bounds."""
    entity.x = clamp(entity.x, entity.radius, WORLD_W - entity.radius)
    entity.y = clamp(entity.y, entity.radius, WORLD_H - entity.radius)


def nearest_obstacle_corner(x: float, y: float) -> Tuple[float, float]:
    """Nearest AABB corner point (first-wins tie order over the 5 boxes)."""
    best: Optional[Tuple[float, float]] = None
    best_d2 = float("inf")
    for bx, by, bw, bh in OBSTACLES:
        for cx, cy in ((bx, by), (bx + bw, by), (bx, by + bh), (bx + bw, by + bh)):
            d2 = (cx - x) * (cx - x) + (cy - y) * (cy - y)
            if d2 < best_d2:
                best_d2 = d2
                best = (cx, cy)
    assert best is not None
    return best


# ---------------------------------------------------------------------------
# Entities
# ---------------------------------------------------------------------------

@dataclass
class Entity:
    """Circle entity (player or bot); coordinates in world units."""

    id: int
    x: float
    y: float
    vx: float
    vy: float
    hp: float
    radius: float


@dataclass
class Bot(Entity):
    """Wave bot carrying its deterministic FSM state."""

    wave: int = 1
    hp_max: float = 30.0
    speed: float = 150.0
    jitter_deg: float = 12.0
    state: str = BOT_PATROL
    fsm_timer: float = 0.0
    patrol_timer: float = 0.0
    waypoint: Optional[Tuple[float, float]] = None
    orbit_sign: float = 1.0
    fire_cd: float = 0.0
    index_in_wave: int = 0


@dataclass
class Projectile:
    """Projectile entity (id drawn from the shared ascending id counter)."""

    id: int
    x: float
    y: float
    vx: float
    vy: float
    life: float
    owner_id: int
    from_player: bool
    radius: float
    damage: float
    hp: float = 0.0  # serialized in the checksum; projectiles carry 0


@dataclass(frozen=True)
class RawInput:
    """Continuous player input (the live game's input frame, PROTOCOL §8).

    ``move`` is an analog direction (any magnitude; it is normalized internally),
    ``fire`` is the aim direction or ``None`` for no fire, ``dash``/``nova`` are
    one-shot ability requests. Dash direction is the current move direction
    (falling back to the player's facing when the move stick is neutral).
    """

    move: Tuple[float, float] = (0.0, 0.0)
    fire: Optional[Tuple[float, float]] = None
    dash: bool = False
    nova: bool = False


# ---------------------------------------------------------------------------
# World
# ---------------------------------------------------------------------------

class World:
    """Deterministic Protocol v1 wave-survival world.

    One :meth:`tick` advances exactly one 60 Hz simulation tick following the
    fixed order of PROTOCOL §5. The world is fully deterministic given the seed
    and the sequence of player inputs.
    """

    def __init__(self, seed: int) -> None:
        self.seed: int = int(seed)
        self.rng = SplitMix64(self.seed)
        self.tick: int = 0
        self.time: float = 0.0
        self.score: int = 0
        self.combo: int = 1
        self.combo_timer: float = 0.0
        self.wave: int = 1
        self.kills: int = 0

        px, py = PLAYER_SPAWN
        self.player: Entity = Entity(
            id=0, x=px, y=py, vx=0.0, vy=0.0, hp=PLAYER_MAX_HP, radius=PLAYER_RADIUS,
        )
        self.energy: float = PLAYER_ENERGY_MAX
        self.player_fire_cd: float = 0.0
        self.player_dash_cd: float = 0.0
        self.facing: Tuple[float, float] = (1.0, 0.0)

        self.bots: List[Bot] = []
        self.projectiles: List[Projectile] = []
        self.next_id: int = 1

        #: Pending wave spawns: (due_time, wave_number, index_in_wave).
        self.spawn_queue: List[Tuple[float, int, int]] = []
        self._queue_wave(1)

        self._survival_next: float = 1.0
        self.events: List[dict] = []
        self.done: bool = False
        self.checksum: int = compute_checksum(self)

    # -- waves ---------------------------------------------------------------

    def _queue_wave(self, wave: int) -> None:
        n = bot_count(wave)
        self.spawn_queue = [
            (k * BOT_SPAWN_STAGGER, wave, k) for k in range(n)
        ]

    def _spawn_bot(self, wave: int, k: int) -> None:
        n = bot_count(wave)
        sx, sy = SPAWN_POINTS[k % len(SPAWN_POINTS)]
        bot = Bot(
            id=self.next_id,
            x=sx,
            y=sy,
            vx=0.0,
            vy=0.0,
            hp=bot_hp(wave),
            radius=BOT_RADIUS,
            wave=wave,
            hp_max=bot_hp(wave),
            speed=bot_speed(wave),
            jitter_deg=bot_aim_jitter_deg(wave),
            state=BOT_PATROL,
            # FSM transitions every 0.25 s, staggered by bot_id * 0.25 / n_bots.
            fsm_timer=k * BOT_FSM_INTERVAL / n,
            patrol_timer=0.0,
            orbit_sign=1.0,
            fire_cd=0.0,
            index_in_wave=k,
        )
        self.next_id += 1
        self.bots.append(bot)

    def _spawn_projectile(self, owner: Entity, direction: Tuple[float, float],
                          from_player: bool) -> None:
        speed = RIFLE_PROJ_SPEED if from_player else BOT_PROJ_SPEED
        lifetime = RIFLE_LIFETIME if from_player else BOT_PROJ_LIFETIME
        damage = RIFLE_DAMAGE if from_player else BOT_DAMAGE
        spawn_r = owner.radius + 6.0
        self.projectiles.append(
            Projectile(
                id=self.next_id,
                x=owner.x + direction[0] * spawn_r,
                y=owner.y + direction[1] * spawn_r,
                vx=direction[0] * speed,
                vy=direction[1] * speed,
                life=lifetime,
                owner_id=owner.id,
                from_player=from_player,
                radius=RIFLE_PROJ_RADIUS,
                damage=damage,
            )
        )
        self.next_id += 1

    # -- bot FSM (PROTOCOL §7) -------------------------------------------------

    def _bot_fsm(self, bot: Bot) -> None:
        """Re-evaluate a bot's FSM state (called when its staggered timer fires)."""
        p = self.player
        prev = bot.state
        dx = p.x - bot.x
        dy = p.y - bot.y
        dist = math.sqrt(dx * dx + dy * dy)

        if bot.hp < 0.25 * bot.hp_max:
            state = BOT_FLEE
        elif dist < 420.0 and los_clear(bot.x, bot.y, p.x, p.y):
            state = BOT_ATTACK
        elif dist < 260.0:
            state = BOT_STRAFE
        elif dist < 520.0:
            state = BOT_CHASE
        else:
            state = BOT_PATROL

        bot.state = state
        bot.fsm_timer += BOT_FSM_INTERVAL

        # Orbit sign comes from the shared RNG at entry into an orbit state.
        if state in (BOT_STRAFE, BOT_ATTACK) and prev not in (BOT_STRAFE, BOT_ATTACK):
            bot.orbit_sign = 1.0 if self.rng.uniform01() < 0.5 else -1.0
        # PATROL picks a random waypoint every 4 s (2 RNG draws: x then y).
        if state == BOT_PATROL and (bot.waypoint is None or bot.patrol_timer <= 0.0):
            bot.waypoint = (self.rng.uniform01() * WORLD_W, self.rng.uniform01() * WORLD_H)
            bot.patrol_timer = BOT_PATROL_INTERVAL

    def _bot_move(self, bot: Bot) -> Tuple[Tuple[float, float], float]:
        """Return (unit move dir, speed scale) for the bot's current state."""
        p = self.player
        if bot.state == BOT_PATROL:
            if bot.waypoint is None:
                return ((0.0, 0.0), 1.0)
            dx = bot.waypoint[0] - bot.x
            dy = bot.waypoint[1] - bot.y
            if dx * dx + dy * dy < BOT_PATROL_ARRIVE * BOT_PATROL_ARRIVE:
                return ((0.0, 0.0), 1.0)
            return (normalize((dx, dy)) or (0.0, 0.0), 1.0)
        if bot.state == BOT_CHASE:
            return (normalize((p.x - bot.x, p.y - bot.y)) or (0.0, 0.0), 1.0)
        if bot.state in (BOT_STRAFE, BOT_ATTACK):
            # Orbit the player at 0.6x speed along the tangent.
            tx = -(p.y - bot.y) * bot.orbit_sign
            ty = (p.x - bot.x) * bot.orbit_sign
            return (normalize((tx, ty)) or (0.0, 0.0), 0.6)
        # FLEE: blend "away from player" with "toward nearest obstacle corner".
        away = normalize((bot.x - p.x, bot.y - p.y)) or (0.0, 0.0)
        corner = nearest_obstacle_corner(bot.x, bot.y)
        to_corner = normalize((corner[0] - bot.x, corner[1] - bot.y)) or (0.0, 0.0)
        return (normalize((away[0] + to_corner[0], away[1] + to_corner[1])) or (0.0, 0.0), 1.0)

    # -- main tick (PROTOCOL §5) -----------------------------------------------

    def tick(self, inp: RawInput) -> None:
        """Advance the world by one tick using the given player input."""
        if self.done:
            return
        self.time += DT
        self.tick += 1
        self.events = []

        # 1. Timers: dash cooldown, fire cooldown, combo timer, bot timers.
        self.player_dash_cd = max(0.0, self.player_dash_cd - DT)
        self.player_fire_cd = max(0.0, self.player_fire_cd - DT)
        if self.combo_timer > 0.0:
            self.combo_timer = max(0.0, self.combo_timer - DT)
            if self.combo_timer == 0.0:
                self.combo = 1
        for bot in self.bots:
            bot.fire_cd = max(0.0, bot.fire_cd - DT)
            bot.fsm_timer -= DT
            bot.patrol_timer -= DT

        # 2. Movement (player, then bots ascending id).
        p = self.player
        move = normalize(inp.move)
        if move is not None:
            self.facing = move
        target_vx = move[0] * PLAYER_SPEED if move is not None else 0.0
        target_vy = move[1] * PLAYER_SPEED if move is not None else 0.0
        p.vx += (target_vx - p.vx) * 0.2
        p.vy += (target_vy - p.vy) * 0.2
        if inp.dash and self.player_dash_cd <= 0.0:
            dash_dir = move if move is not None else self.facing
            p.vx += dash_dir[0] * PLAYER_DASH_IMPULSE
            p.vy += dash_dir[1] * PLAYER_DASH_IMPULSE
            self.player_dash_cd = PLAYER_DASH_COOLDOWN
            self.events.append({"kind": "dash"})
        p.x += p.vx * DT
        p.y += p.vy * DT
        for bot in self.bots:
            if bot.hp <= 0.0:
                continue  # dead-pending (nova this tick): inert until removal
            if bot.fsm_timer <= 0.0:
                self._bot_fsm(bot)
            direction, scale = self._bot_move(bot)
            target_vx = direction[0] * bot.speed * scale
            target_vy = direction[1] * bot.speed * scale
            bot.vx += (target_vx - bot.vx) * 0.2
            bot.vy += (target_vy - bot.vy) * 0.2
            bot.x += bot.vx * DT
            bot.y += bot.vy * DT

        # 3. World resolve: circle-vs-AABB push-out, then world bounds.
        resolve_obstacles(p)
        for bot in self.bots:
            resolve_obstacles(bot)
        clamp_world(p)
        for bot in self.bots:
            clamp_world(bot)

        # 4. Firing (player spread first, then bots ascending id = "effect jitter").
        if (inp.fire is not None and self.player_fire_cd <= 0.0
                and self.energy >= RIFLE_ENERGY_COST):
            base = normalize(inp.fire) or (1.0, 0.0)
            angle = math.radians((self.rng.uniform01() * 2.0 - 1.0) * RIFLE_SPREAD_DEG)
            self._spawn_projectile(p, rotate(base, angle), from_player=True)
            self.energy -= RIFLE_ENERGY_COST
            self.player_fire_cd = RIFLE_FIRE_INTERVAL
        for bot in self.bots:
            if bot.hp <= 0.0 or bot.state != BOT_ATTACK or bot.fire_cd > 0.0:
                continue
            base = normalize((p.x - bot.x, p.y - bot.y)) or (1.0, 0.0)
            angle = math.radians((self.rng.uniform01() * 2.0 - 1.0) * bot.jitter_deg)
            self._spawn_projectile(bot, rotate(base, angle), from_player=False)
            bot.fire_cd = BOT_FIRE_INTERVAL

        # 5. Projectiles (ascending id): integrate, then despawn checks.
        alive: List[Projectile] = []
        for proj in self.projectiles:
            proj.x += proj.vx * DT
            proj.y += proj.vy * DT
            proj.life -= DT
            if proj.life <= 0.0:
                continue
            if not (0.0 <= proj.x <= WORLD_W and 0.0 <= proj.y <= WORLD_H):
                continue
            if self._proj_hits_obstacle(proj):
                continue
            if self._proj_hits_entity(proj):
                continue
            alive.append(proj)
        self.projectiles = alive

        # 6. Deaths (ascending id).
        survivors: List[Bot] = []
        for bot in self.bots:
            if bot.hp <= 0.0:
                self.score += 100 * self.combo
                self.combo = min(self.combo + 1, COMBO_MAX)
                self.combo_timer = COMBO_WINDOW
                self.kills += 1
                self.events.append({"kind": "kill", "bot_id": bot.id})
            else:
                survivors.append(bot)
        self.bots = survivors
        if p.hp <= 0.0:
            p.hp = 0.0
            self.events.append({"kind": "match_end"})
            self.done = True

        # 7. Nova (triggered && energy >= cost).
        if inp.nova and self.energy >= NOVA_ENERGY_COST:
            self.energy -= NOVA_ENERGY_COST
            hits = 0
            for bot in self.bots:
                dx = bot.x - p.x
                dy = bot.y - p.y
                d2 = dx * dx + dy * dy
                if d2 <= NOVA_RADIUS * NOVA_RADIUS:
                    bot.hp -= NOVA_DAMAGE
                    d = math.sqrt(d2)
                    if d > 1e-9:
                        nx = dx / d
                        ny = dy / d
                    else:  # bot exactly at center: canonical +x direction
                        nx, ny = 1.0, 0.0
                    bot.vx += nx * NOVA_KNOCKBACK
                    bot.vy += ny * NOVA_KNOCKBACK
                    hits += 1
            self.events.append({"kind": "nova", "hits": hits})

        # 8. Regen (player energy only; bots have unlimited fire energy).
        self.energy = min(PLAYER_ENERGY_MAX, self.energy + PLAYER_ENERGY_REGEN * DT)

        # 9. Survival score: every full elapsed second.
        while self.time >= self._survival_next:
            self.score += SURVIVAL_SCORE_PER_SEC
            self._survival_next += 1.0

        # 10. Waves: release due spawns; advance wave when the arena is cleared.
        if not self.done:
            pending: List[Tuple[float, int, int]] = []
            for due, wave_no, k in self.spawn_queue:
                if due <= self.time:
                    self._spawn_bot(wave_no, k)
                else:
                    pending.append((due, wave_no, k))
            self.spawn_queue = pending
            if not self.spawn_queue and not self.bots:
                self.score += wave_bonus(self.wave)
                self.events.append({"kind": "wave_cleared", "wave": self.wave})
                self.wave += 1
                self._queue_wave(self.wave)

        # 11. Update checksum.
        self.checksum = compute_checksum(self)

    def _proj_hits_obstacle(self, proj: Projectile) -> bool:
        """Center-clamp check of the projectile circle against each AABB."""
        px, py, r = proj.x, proj.y, proj.radius
        for bx, by, bw, bh in OBSTACLES:
            cx = clamp(px, bx, bx + bw)
            cy = clamp(py, by, by + bh)
            dx = px - cx
            dy = py - cy
            if dx * dx + dy * dy < r * r:
                return True
        return False

    def _proj_hits_entity(self, proj: Projectile) -> bool:
        """Circle-circle entity hit; applies damage and emits the hit event."""
        p = self.player
        if proj.from_player:
            for bot in self.bots:
                dx = bot.x - proj.x
                dy = bot.y - proj.y
                total = proj.radius + bot.radius
                if dx * dx + dy * dy < total * total:
                    bot.hp -= proj.damage
                    self.events.append(
                        {"kind": "hit", "from_player": True, "damage": proj.damage,
                         "bot_id": bot.id}
                    )
                    return True
            return False
        dx = p.x - proj.x
        dy = p.y - proj.y
        total = proj.radius + p.radius
        if dx * dx + dy * dy < total * total:
            p.hp -= proj.damage
            self.events.append(
                {"kind": "hit", "from_player": False, "damage": proj.damage}
            )
            return True
        return False


# ---------------------------------------------------------------------------
# Scripted reference player ("wave-survival-default")
# ---------------------------------------------------------------------------

class ScriptedPolicy:
    """The deterministic scripted player used for golden vectors and as the
    evaluation baseline.

    Behaviour (per spec):

    * Waypoints cycle every 120 ticks over ``[(400,250), (1200,250), (1200,650), (400,650)]``;
      move toward the active waypoint (neutral dir within 20 u).
    * Fire every tick at the nearest bot (``(1, 0)`` when no bots exist).
    * Dash away from the nearest bot when the dash is ready and a bot is within 150 u
      (the dash direction is the move input, so the move dir is overridden on dash ticks).
    * Nova when energy >= 55 and at least 2 bots are within 210 u.
    """

    WAYPOINTS: Tuple[Tuple[float, float], ...] = (
        (400.0, 250.0), (1200.0, 250.0), (1200.0, 650.0), (400.0, 650.0),
    )
    WAYPOINT_HOLD_TICKS: int = 120

    def act(self, world: World) -> RawInput:
        """Return the scripted RawInput for the world's current (pre-tick) state."""
        p = world.player
        wp = self.WAYPOINTS[(world.tick // self.WAYPOINT_HOLD_TICKS) % len(self.WAYPOINTS)]
        dx = wp[0] - p.x
        dy = wp[1] - p.y
        move: Tuple[float, float] = (0.0, 0.0)
        if dx * dx + dy * dy > 20.0 * 20.0:
            move = normalize((dx, dy)) or (0.0, 0.0)

        nearest: Optional[Bot] = None
        nearest_d2 = float("inf")
        close_bots = 0
        for bot in world.bots:
            if bot.hp <= 0.0:
                continue
            bdx = bot.x - p.x
            bdy = bot.y - p.y
            d2 = bdx * bdx + bdy * bdy
            if d2 < nearest_d2:
                nearest_d2 = d2
                nearest = bot
            if d2 <= NOVA_RADIUS * NOVA_RADIUS:
                close_bots += 1

        fire: Tuple[float, float] = (1.0, 0.0)
        if nearest is not None:
            fire = normalize((nearest.x - p.x, nearest.y - p.y)) or (1.0, 0.0)

        dash = False
        if (nearest is not None and world.player_dash_cd <= 0.0
                and nearest_d2 < 150.0 * 150.0):
            dash = True
            away = normalize((p.x - nearest.x, p.y - nearest.y))
            if away is not None:
                move = away

        nova = world.energy >= NOVA_ENERGY_COST and close_bots >= 2
        return RawInput(move=move, fire=fire, dash=dash, nova=nova)
