"""VOIDSTRIKE — Deterministic Simulation Protocol v1 (Python reference port).

`rules.py` mirrors core/c/src/world.c tick-for-tick so that RL environments
train on the exact live game. Conformance is enforced by golden vectors
(`testdata/golden/ticks.json`).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

# ---- Protocol constants (docs/PROTOCOL.md §2–§3) ----
WORLD_W = 1600.0
WORLD_H = 900.0
DT = 0.016666666666666666  # literal 1/60 — never recompute

PLAYER_RADIUS = 14.0
PLAYER_MAX_HP = 100.0
PLAYER_SPEED = 260.0
PLAYER_ENERGY_MAX = 100.0
PLAYER_ENERGY_REGEN = 14.0
DASH_COOLDOWN = 3.0
DASH_IMPULSE = 720.0

RIFLE_INTERVAL = 0.1
RIFLE_P_RADIUS = 4.0
RIFLE_P_SPEED = 560.0
RIFLE_DAMAGE = 10.0
RIFLE_SPREAD_DEG = 2.0
RIFLE_LIFETIME = 1.2
RIFLE_ENERGY = 2.0

NOVA_ENERGY = 55.0
NOVA_RADIUS = 210.0
NOVA_DAMAGE = 48.0
NOVA_KNOCKBACK = 420.0

BOT_RADIUS = 14.0
BOT_DAMAGE = 8.0
BOT_FIRE_INT = 0.85
BOT_P_SPEED = 480.0
BOT_P_LIFETIME = 1.6
BOT_SPAWN_STAGGER = 0.4

COMBO_WINDOW = 3.0
COMBO_MAX = 5

MAX_UNITS = 512
MAX_PROJECTILES = 256
MAX_EVENTS = 256
WAVE_BOT_CAP = 63

OBSTACLES = [
    (200.0, 150.0, 220.0, 40.0),
    (1180.0, 150.0, 220.0, 40.0),
    (200.0, 710.0, 220.0, 40.0),
    (700.0, 420.0, 200.0, 60.0),
    (1180.0, 710.0, 220.0, 40.0),
]

SPAWN_POINTS = [
    (80.0, 80.0), (1520.0, 80.0), (80.0, 820.0), (1520.0, 820.0),
    (800.0, 40.0), (800.0, 860.0), (40.0, 450.0), (1560.0, 450.0),
]

FNV_OFFSET = 0xCBF29CE484222325
FNV_PRIME = 0x100000001B3
U64_MASK = 0xFFFFFFFFFFFFFFFF


def fnv1a64(data: bytes) -> int:
    """FNV-1a 64 — byte-exact with the C core."""
    h = FNV_OFFSET
    for b in data:
        h = ((h ^ b) * FNV_PRIME) & U64_MASK
    return h


def rules_hash() -> int:
    return fnv1a64(b"VOIDSTRIKE_SIM_V1")


def quantize(v: float) -> int:
    """Canonical quantization: floor(v*1000 + 0.5) — never round()."""
    return int(math.floor(v * 1000.0 + 0.5))


def sm64_next(state: int) -> tuple[int, int]:
    """splitmix64 — returns (new_state, output)."""
    state = (state + 0x9E3779B97F4A7C15) & U64_MASK
    z = state
    z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & U64_MASK
    z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & U64_MASK
    return state, (z ^ (z >> 27)) & U64_MASK


class Rng:
    """The single shared random stream per world (PROTOCOL §4)."""

    __slots__ = ("state",)

    def __init__(self, seed: int) -> None:
        self.state = seed & U64_MASK

    def next(self) -> int:
        self.state, out = sm64_next(self.state)
        return out

    def uniform01(self) -> float:
        return self.next() / 18446744073709551616.0


@dataclass
class Unit:
    id: int
    kind: int  # 0 player, 1 bot
    alive: bool = True
    x: float = 0.0
    y: float = 0.0
    vx: float = 0.0
    vy: float = 0.0
    radius: float = 14.0
    hp: float = 100.0
    max_hp: float = 100.0
    speed: float = 260.0
    fire_cd: float = 0.0
    energy: float = 0.0
    dash_cd: float = 0.0
    # bot-only
    state: int = 0  # 0 PATROL 1 CHASE 2 STRAFE 3 ATTACK 4 FLEE
    state_timer: float = 0.0
    waypoint_timer: float = 0.0
    wpx: float = 0.0
    wpy: float = 0.0
    orbit_sign: int = 1
    wave: int = 0


@dataclass
class Projectile:
    id: int = 0
    owner: int = 0
    alive: bool = False
    team: int = 0  # 0 player, 1 bot
    x: float = 0.0
    y: float = 0.0
    vx: float = 0.0
    vy: float = 0.0
    radius: float = 4.0
    damage: float = 10.0
    life: float = 1.0


@dataclass
class SimEvent:
    kind: str
    a: int = 0
    b: int = 0
    x: float = 0.0
    y: float = 0.0
    value: int = 0


@dataclass
class Input:
    move_x: float = 0.0
    move_y: float = 0.0
    aim_x: float = 0.0
    aim_y: float = 0.0
    fire: bool = False
    dash: bool = False
    nova: bool = False


def _clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else (hi if v > hi else v)


def _norm(x: float, y: float) -> tuple[float, float]:
    l = math.sqrt(x * x + y * y)
    if l < 1e-12:
        return 0.0, 0.0
    return x / l, y / l


def _seg_vs_aabb(x1: float, y1: float, x2: float, y2: float, box) -> bool:
    dx, dy = x2 - x1, y2 - y1
    tmin, tmax = 0.0, 1.0
    if abs(dx) < 1e-12:
        if x1 < box[0] or x1 > box[0] + box[2]:
            return False
    else:
        t1 = (box[0] - x1) / dx
        t2 = (box[0] + box[2] - x1) / dx
        if t1 > t2:
            t1, t2 = t2, t1
        tmin = max(tmin, t1)
        tmax = min(tmax, t2)
        if tmin > tmax:
            return False
    if abs(dy) < 1e-12:
        if y1 < box[1] or y1 > box[1] + box[3]:
            return False
    else:
        t1 = (box[1] - y1) / dy
        t2 = (box[1] + box[3] - y1) / dy
        if t1 > t2:
            t1, t2 = t2, t1
        tmin = max(tmin, t1)
        tmax = min(tmax, t2)
        if tmin > tmax:
            return False
    return True


class World:
    """Protocol v1 world — port of core/c/src/world.c."""

    def __init__(self, seed: int) -> None:
        self.rng = Rng(seed)
        self.seed = seed
        self.time = 0.0
        self.tick_n = 0
        self.next_id = 0
        self.next_proj_id = 0
        self.score = 0
        self.wave = 1
        self.combo = 1
        self.combo_timer = 0.0
        self.survival_accum = 0.0
        self.wave_pending = 3 + 2 * 1
        self.spawn_timer = BOT_SPAWN_STAGGER
        self.spawn_idx = 0
        self.match_over = False
        self.units: list[Unit] = []
        self.projectiles = [Projectile() for _ in range(MAX_PROJECTILES)]
        self.events: list[SimEvent] = []

        player = Unit(
            id=self._take_id(), kind=0,
            x=800.0, y=300.0,
            hp=PLAYER_MAX_HP, max_hp=PLAYER_MAX_HP, speed=PLAYER_SPEED,
            energy=PLAYER_ENERGY_MAX,
        )
        self.units.append(player)
        self.player_idx = 0

    def _take_id(self) -> int:
        v = self.next_id
        self.next_id += 1
        return v

    # ---- helpers ----
    def alive_bots(self) -> int:
        return sum(1 for u in self.units if u.kind == 1 and u.alive)

    def _los(self, ax: float, ay: float, bx: float, by: float) -> bool:
        return not any(_seg_vs_aabb(ax, ay, bx, by, ob) for ob in OBSTACLES)

    def _resolve_aabb(self, u: Unit, box) -> None:
        cx = _clamp(u.x, box[0], box[0] + box[2])
        cy = _clamp(u.y, box[1], box[1] + box[3])
        dx, dy = u.x - cx, u.y - cy
        d2 = dx * dx + dy * dy
        if d2 > u.radius * u.radius:
            return
        if d2 > 1e-12:
            d = math.sqrt(d2)
            nx, ny = dx / d, dy / d
            u.x += nx * (u.radius - d)
            u.y += ny * (u.radius - d)
            vn = u.vx * nx + u.vy * ny
            if vn < 0.0:
                u.vx -= nx * vn
                u.vy -= ny * vn
        else:
            dl = u.x - box[0]
            dr = box[0] + box[2] - u.x
            dtp = u.y - box[1]
            db = box[1] + box[3] - u.y
            m = min(dl, dr, dtp, db)
            if m == dl:
                u.x = box[0] - u.radius
                u.vx = 0.0
            elif m == dr:
                u.x = box[0] + box[2] + u.radius
                u.vx = 0.0
            elif m == dtp:
                u.y = box[1] - u.radius
                u.vy = 0.0
            else:
                u.y = box[1] + box[3] + u.radius
                u.vy = 0.0

    def _spawn_projectile(self, team: int, owner: int, x: float, y: float,
                          dx: float, dy: float, speed: float,
                          radius: float, damage: float, life: float) -> None:
        for p in self.projectiles:
            if not p.alive:
                p.id = self.next_proj_id
                self.next_proj_id += 1
                p.owner = owner
                p.alive = True
                p.team = team
                p.x, p.y = x, y
                p.vx, p.vy = dx * speed, dy * speed
                p.radius = radius
                p.damage = damage
                p.life = life
                return

    def _spawn_bot(self) -> None:
        if len(self.units) >= MAX_UNITS:
            return
        n = self.wave
        hp = min(30.0 + 8.0 * n, 90.0)
        speed = min(150.0 + 6.0 * n, 240.0)
        sp = SPAWN_POINTS[self.spawn_idx % 8]
        self.spawn_idx += 1
        b = Unit(
            id=self._take_id(), kind=1, x=sp[0], y=sp[1],
            hp=hp, max_hp=hp, speed=speed, wave=n,
        )
        b.state_timer = 0.25 * ((b.id % 16) / 16.0)
        self.units.append(b)

    # ---- bot FSM (PROTOCOL §7) ----
    def _reevaluate(self, b: Unit, p: Unit) -> None:
        dist = math.sqrt((p.x - b.x) ** 2 + (p.y - b.y) ** 2)
        if b.hp < 0.25 * b.max_hp:
            ns = 4
        elif dist < 420.0 and self._los(b.x, b.y, p.x, p.y):
            ns = 3
        elif dist < 260.0:
            ns = 2
        elif dist < 520.0:
            ns = 1
        else:
            ns = 0
        if ns != b.state:
            b.state = ns
            if ns in (2, 3):
                b.orbit_sign = -1 if self.rng.uniform01() < 0.5 else 1
            if ns == 0:
                b.waypoint_timer = 0.0

    def _flee_dir(self, b: Unit, p: Unit) -> tuple[float, float]:
        best, best_d = 0, -1.0
        for i, ob in enumerate(OBSTACLES):
            cx, cy = ob[0] + ob[2] * 0.5, ob[1] + ob[3] * 0.5
            d = math.sqrt((cx - b.x) ** 2 + (cy - b.y) ** 2)
            if best_d < 0 or d < best_d:
                best_d, best = d, i
        ob = OBSTACLES[best]
        corners = [(ob[0], ob[1]), (ob[0] + ob[2], ob[1]),
                   (ob[0], ob[1] + ob[3]), (ob[0] + ob[2], ob[1] + ob[3])]
        bx, by, bd = 0.0, 0.0, -1.0
        for cx, cy in corners:
            dp = math.sqrt((cx - p.x) ** 2 + (cy - p.y) ** 2)
            if dp > bd:
                bd, bx, by = dp, cx, cy
        return _norm(bx - b.x, by - b.y)

    def _bot_update(self, b: Unit, p: Unit) -> tuple[float, float]:
        dist = math.sqrt((p.x - b.x) ** 2 + (p.y - b.y) ** 2)
        b.state_timer -= DT
        if b.state_timer <= 0.0:
            b.state_timer = 0.25
            self._reevaluate(b, p)

        if b.state == 0:  # PATROL
            b.waypoint_timer -= DT
            wd = math.sqrt((b.wpx - b.x) ** 2 + (b.wpy - b.y) ** 2)
            if b.waypoint_timer <= 0.0 or wd < 20.0:
                b.wpx = self.rng.uniform01() * WORLD_W   # draw 1
                b.wpy = self.rng.uniform01() * WORLD_H   # draw 2
                b.waypoint_timer = 4.0
            dir = _norm(b.wpx - b.x, b.wpy - b.y)
        elif b.state == 1:  # CHASE
            dir = _norm(p.x - b.x, p.y - b.y)
        elif b.state in (2, 3):  # STRAFE / ATTACK
            tx, ty = _norm(p.x - b.x, p.y - b.y)
            dir = (-ty * b.orbit_sign, tx * b.orbit_sign)
        else:  # FLEE
            dir = self._flee_dir(b, p)

        if b.state == 3 and b.fire_cd <= 0.0 and self.units[self.player_idx].alive \
                and dist < 420.0 and self._los(b.x, b.y, p.x, p.y):
            ax, ay = _norm(p.x - b.x, p.y - b.y)
            if ax == 0.0 and ay == 0.0:
                ax, ay = 1.0, 0.0
            b.fire_cd = BOT_FIRE_INT
            jitter = (self.rng.uniform01() * 2.0 - 1.0) * max(3.0, 12.0 - 0.5 * b.wave) * (math.pi / 180.0)
            c, s = math.cos(jitter), math.sin(jitter)
            dx = ax * c - ay * s
            dy = ax * s + ay * c
            self._spawn_projectile(1, b.id, b.x + dx * (b.radius + 6.0), b.y + dy * (b.radius + 6.0),
                                   dx, dy, BOT_P_SPEED, 4.0, BOT_DAMAGE, BOT_P_LIFETIME)
        return dir

    # ---- main tick ----
    def tick(self, inp: Input | None = None) -> None:
        if inp is None:
            inp = Input()
        self.events = []
        p = self.units[self.player_idx]

        # 1. timers
        self.time += DT
        self.tick_n += 1
        if self.combo > 1:
            self.combo_timer -= DT
            if self.combo_timer <= 0.0:
                self.combo = 1
        for u in self.units:
            if u.fire_cd > 0.0:
                u.fire_cd -= DT
            if u.dash_cd > 0.0:
                u.dash_cd -= DT
        if self.spawn_timer > 0.0:
            self.spawn_timer -= DT

        al = math.sqrt(inp.aim_x ** 2 + inp.aim_y ** 2)
        aim = (inp.aim_x / al, inp.aim_y / al) if al >= 1e-12 else (1.0, 0.0)

        # 2. movement — player
        if p.alive:
            ml = math.sqrt(inp.move_x ** 2 + inp.move_y ** 2)
            if ml > 1.0:
                dmx, dmy = inp.move_x / ml, inp.move_y / ml
            elif ml > 0.0:
                dmx, dmy = inp.move_x, inp.move_y
            else:
                dmx, dmy = 0.0, 0.0
            if inp.dash and p.dash_cd <= 0.0:
                p.dash_cd = DASH_COOLDOWN
                ddx, ddy = (dmx, dmy) if (dmx, dmy) != (0.0, 0.0) else aim
                if ddx == 0.0 and ddy == 0.0:
                    ddx, ddy = 1.0, 0.0
                p.vx += ddx * DASH_IMPULSE
                p.vy += ddy * DASH_IMPULSE
            p.vx += (dmx * p.speed - p.vx) * 0.2
            p.vy += (dmy * p.speed - p.vy) * 0.2
            p.x += p.vx * DT
            p.y += p.vy * DT

            if inp.fire and p.fire_cd <= 0.0 and p.energy >= RIFLE_ENERGY:
                spread = (self.rng.uniform01() * 2.0 - 1.0) * (RIFLE_SPREAD_DEG * (math.pi / 180.0))
                c, s = math.cos(spread), math.sin(spread)
                dx = aim[0] * c - aim[1] * s
                dy = aim[0] * s + aim[1] * c
                p.energy -= RIFLE_ENERGY
                p.fire_cd = RIFLE_INTERVAL
                self._spawn_projectile(0, p.id, p.x + dx * (p.radius + 6.0), p.y + dy * (p.radius + 6.0),
                                       dx, dy, RIFLE_P_SPEED, RIFLE_P_RADIUS, RIFLE_DAMAGE, RIFLE_LIFETIME)

        # 2. movement — bots
        for i in range(1, len(self.units)):
            b = self.units[i]
            if not b.alive:
                continue
            dx, dy = self._bot_update(b, p)
            mul = 0.6 if b.state in (2, 3) else 1.0
            b.vx += (dx * b.speed * mul - b.vx) * 0.2
            b.vy += (dy * b.speed * mul - b.vy) * 0.2
            b.x += b.vx * DT
            b.y += b.vy * DT

        # 3. world resolve
        for u in self.units:
            if not u.alive:
                continue
            if u.x < u.radius:
                u.x = u.radius
                if u.vx < 0.0:
                    u.vx = 0.0
            if u.x > WORLD_W - u.radius:
                u.x = WORLD_W - u.radius
                if u.vx > 0.0:
                    u.vx = 0.0
            if u.y < u.radius:
                u.y = u.radius
                if u.vy < 0.0:
                    u.vy = 0.0
            if u.y > WORLD_H - u.radius:
                u.y = WORLD_H - u.radius
                if u.vy > 0.0:
                    u.vy = 0.0
            for ob in OBSTACLES:
                self._resolve_aabb(u, ob)

        # 5. projectiles
        for pr in self.projectiles:
            if not pr.alive:
                continue
            despawn = False
            pr.x += pr.vx * DT
            pr.y += pr.vy * DT
            pr.life -= DT
            if pr.life <= 0.0:
                despawn = True
            if not despawn and not (0.0 <= pr.x <= WORLD_W and 0.0 <= pr.y <= WORLD_H):
                despawn = True
            if not despawn:
                for ob in OBSTACLES:
                    cx = _clamp(pr.x, ob[0], ob[0] + ob[2])
                    cy = _clamp(pr.y, ob[1], ob[1] + ob[3])
                    if (pr.x - cx) ** 2 + (pr.y - cy) ** 2 < pr.radius * pr.radius:
                        despawn = True
                        break
            if not despawn:
                if pr.team == 0:
                    for u in self.units[1:]:
                        if not u.alive or u.kind != 1:
                            continue
                        rr = pr.radius + u.radius
                        if (pr.x - u.x) ** 2 + (pr.y - u.y) ** 2 < rr * rr:
                            u.hp -= pr.damage
                            self.events.append(SimEvent("hit", a=pr.id, b=u.id, x=pr.x, y=pr.y, value=int(pr.damage)))
                            despawn = True
                            break
                elif p.alive:
                    rr = pr.radius + p.radius
                    if (pr.x - p.x) ** 2 + (pr.y - p.y) ** 2 < rr * rr:
                        p.hp -= pr.damage
                        self.events.append(SimEvent("hit", a=pr.id, b=p.id, x=pr.x, y=pr.y, value=int(pr.damage)))
                        despawn = True
            if despawn:
                pr.alive = False

        # 6. nova
        if p.alive and inp.nova and p.energy >= NOVA_ENERGY:
            p.energy -= NOVA_ENERGY
            self.events.append(SimEvent("nova", a=p.id, x=p.x, y=p.y))
            for u in self.units[1:]:
                if not u.alive or u.kind != 1:
                    continue
                dx, dy = u.x - p.x, u.y - p.y
                d = math.sqrt(dx * dx + dy * dy)
                if d <= NOVA_RADIUS:
                    nx, ny = _norm(dx, dy)
                    u.hp -= NOVA_DAMAGE
                    u.vx += nx * NOVA_KNOCKBACK
                    u.vy += ny * NOVA_KNOCKBACK

        # 7. deaths
        for u in self.units:
            if not u.alive or u.hp > 0.0:
                continue
            u.alive = False
            if u.kind == 1:
                self.score += 100 * self.combo
                self.combo = min(self.combo + 1, COMBO_MAX)
                self.combo_timer = COMBO_WINDOW
                self.events.append(SimEvent("kill", a=u.id, x=u.x, y=u.y, value=self.combo))
            else:
                self.match_over = True
                self.events.append(SimEvent("death", a=u.id, x=u.x, y=u.y))
                self.events.append(SimEvent("match_end", a=u.id, x=u.x, y=u.y, value=self.wave))

        # 8. regen
        if p.alive and p.energy < PLAYER_ENERGY_MAX:
            p.energy += PLAYER_ENERGY_REGEN * DT
            if p.energy > PLAYER_ENERGY_MAX:
                p.energy = PLAYER_ENERGY_MAX

        # 9. survival score
        self.survival_accum += DT
        while self.survival_accum >= 1.0:
            self.survival_accum -= 1.0
            if not self.match_over:
                self.score += 1

        # 10. wave director
        if self.wave_pending > 0 and self.spawn_timer <= 0.0 and not self.match_over:
            self._spawn_bot()
            self.wave_pending -= 1
            self.spawn_timer = BOT_SPAWN_STAGGER
        if self.wave_pending == 0 and not self.match_over and self.alive_bots() == 0 and self.tick_n > 1:
            self.score += 250 + 50 * self.wave
            self.wave += 1
            self.wave_pending = min(3 + 2 * self.wave, WAVE_BOT_CAP)
            self.spawn_timer = BOT_SPAWN_STAGGER
            self.events.append(SimEvent("wave", value=self.wave))

    # ---- checksum (byte-exact with the C core) ----
    def checksum(self) -> int:
        h = FNV_OFFSET

        def mix(b: int) -> None:
            nonlocal h
            h = ((h ^ (b & 0xFF)) * FNV_PRIME) & U64_MASK

        def mix_u32(v: int) -> None:
            for i in range(4):
                mix((v >> (8 * i)) & 0xFF)

        def mix_i64(v: int) -> None:
            for i in range(8):
                mix((v >> (8 * i)) & 0xFF)

        for u in self.units:
            mix_u32(u.id)
            mix_i64(quantize(u.x))
            mix_i64(quantize(u.y))
            mix_i64(quantize(u.vx))
            mix_i64(quantize(u.vy))
            mix_i64(quantize(u.hp))
            mix(u.kind)
            mix(1 if u.alive else 0)
        mix_u32(len(self.units))
        mix_i64(self.score)
        mix_u32(self.wave)
        mix_i64(rules_hash())
        return h
