/// VOIDSTRIKE — offline Onslaught game, GTA-style third-person view.
///
/// The sim mirrors Protocol v1 (fixed 60Hz accumulator, same FSM thresholds
/// as the server). The presentation is a pseudo-3D "Grove Block" city seen
/// from a behind-the-character follow camera that orbits with drag-look:
/// perspective-projected asphalt avenue with lane markings and crosswalks,
/// sidewalks, extruded derelict buildings, an abandoned DINER + brick walls
/// built exactly over the five cover footprints, palms, streetlights and
/// parked wrecks. Fighters render as billboarded street characters (back /
/// side / front views with a walk cycle) aiming real rifles.
library;

import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flame/game.dart';
import 'package:flutter/painting.dart'
    show TextBaseline, TextPainter, TextSpan, TextStyle, FontWeight;

import 'protocol.dart';

// ------------------------------------------------------------------ camera

/// Camera distance behind the anchor (world units, ~15m).
const double kCamDist = 300;
/// Camera eye height above the street (world units, ~5m).
const double kEyeH = 100;
/// Horizon line as a fraction of viewport height.
const double kHorizonFrac = 0.34;
/// Figure height in world units (~1.8m).
const double kFigureH = 36;
/// Chest height for tracers / flashes (world units).
const double kChestH = 26;

enum BotAiState { patrol, chase, strafe, attack, flee }

class Fighter {
  Fighter(this.id, this.x, this.y, this.radius);
  final int id;
  double x, y;
  double vx = 0, vy = 0;
  double radius;
  double hp = 100, maxHp = 100;
  double speed = 260;
  double fireCd = 0;
  bool alive = true;
  // bot fields
  BotAiState state = BotAiState.patrol;
  double stateTimer = 0;
  double waypointTimer = 0;
  double wpx = 0, wpy = 0;
  int orbitSign = 1;
  int waveN = 1;
  // player fields (protocol parity)
  double energy = 100;
  double dashCd = 0;
  // cosmetic animation (render layer only)
  double gait = 0, stride = 0, lastX = 0, lastY = 0;
  double yaw = 0; // smoothed facing (radians, world)
  double deathT = -1;
  bool animInit = false;

  void initAnim() {
    if (!animInit) {
      animInit = true;
      lastX = x;
      lastY = y;
    }
  }
}

/// Position-anchored muzzle flash (render layer).
class Flash {
  Flash(this.x, this.y, this.dx, this.dy, this.fromPlayer);
  final double x, y, dx, dy;
  final bool fromPlayer;
  double life = 0.07;
}

class Bullet {
  Bullet(this.x, this.y, this.vx, this.vy, this.fromPlayer);
  double x, y, vx, vy;
  final bool fromPlayer;
  double life = 1.2;
  final double radius = 4;
}

/// Expanding ground ring (nova / kill shockwave).
class GroundRing {
  GroundRing(this.x, this.y, this.maxR, this.color);
  final double x, y, maxR;
  final ui.Color color;
  double r = 8;
  double life = 0.45;
}

class MatchResult {
  MatchResult(this.score, this.kills, this.wave, this.durationSec);
  final int score, kills, wave, durationSec;
}

/// Callback when the run ends (drives the results sheet).
typedef OnMatchOver = void Function(MatchResult result);

// ------------------------------------------------------------------- world

/// Static city dressing (all outside the playable bounds except cover).
class _Building {
  _Building(this.x, this.y, this.w, this.d, this.h, this.tint);
  final double x, y, w, d, h;
  final ui.Color tint;
}

class _Prop {
  _Prop(this.x, this.y, this.kind);
  final double x, y;
  final String kind; // palm | light | car | dumpster
}

class VoidstrikeGame extends FlameGame {
  VoidstrikeGame({required this.onMatchOver, this.seed = 1337});

  final OnMatchOver onMatchOver;
  final int seed;
  late final math.Random rng = math.Random(seed);

  late Fighter player;
  final List<Fighter> bots = [];
  final List<Bullet> bullets = [];
  final List<Flash> flashes = [];
  final List<GroundRing> rings = [];

  int score = 0, kills = 0, wave = 1, combo = 1;
  double comboTimer = 0, spawnTimer = VsBot.spawnStagger, elapsed = 0;
  int wavePending = VsBot.countFor(1), spawnIdx = 0, nextId = 0;
  bool matchOver = false;

  // input state (wired from widgets)
  double moveX = 0, moveY = 0; // stick deflection (screen space)
  double aimX = 0, aimY = -1; // world-space aim (unit vector)
  bool firing = false;
  bool dashQueued = false, novaQueued = false;

  // GTA camera orbit state
  double camYaw = 0; // 0 = looking north (-y)
  double camX = 800, camY = 406;

  /// Ambient scene clock.
  double sceneT = 0;

  // aim assist: re-engages after this many seconds without manual aim input
  double _manualAimTimer = 0;
  static const double _manualAimHold = 2.5;

  ui.Picture? _dinerSign;

  static const List<List<double>> obstacles = [
    [200, 150, 220, 40],
    [1180, 150, 220, 40],
    [200, 710, 220, 40],
    [700, 420, 200, 60],
    [1180, 710, 220, 40],
  ];

  /// Wave spawn points — arena corners and mid edges (cycled).
  static const List<List<double>> spawnPoints = [
    [90, 90],
    [1510, 90],
    [90, 810],
    [1510, 810],
    [800, 70],
    [800, 830],
  ];

  static final List<_Building> buildings = [
    // North row (behind y < -180)
    _Building(-140, -540, 300, 340, 190, ui.Color(0xFF6E4A3A)),
    _Building(190, -520, 260, 320, 260, ui.Color(0xFF77796F)),
    _Building(490, -560, 320, 360, 150, ui.Color(0xFF93876E)),
    _Building(850, -520, 280, 320, 300, ui.Color(0xFF5F6A72)),
    _Building(1170, -550, 300, 340, 200, ui.Color(0xFF6E4A3A)),
    _Building(1510, -510, 280, 310, 250, ui.Color(0xFF77796F)),
    // South row
    _Building(-160, 1080, 300, 330, 230, ui.Color(0xFF77796F)),
    _Building(180, 1100, 280, 310, 160, ui.Color(0xFF93876E)),
    _Building(500, 1080, 320, 330, 280, ui.Color(0xFF6E4A3A)),
    _Building(860, 1110, 280, 300, 180, ui.Color(0xFF5F6A72)),
    _Building(1180, 1080, 300, 330, 240, ui.Color(0xFF93876E)),
    _Building(1520, 1100, 280, 310, 190, ui.Color(0xFF77796F)),
    // West end
    _Building(-560, 40, 340, 320, 280, ui.Color(0xFF5F6A72)),
    _Building(-540, 420, 320, 300, 200, ui.Color(0xFF93876E)),
    // East end
    _Building(1820, 60, 340, 320, 300, ui.Color(0xFF6E4A3A)),
    _Building(1840, 440, 320, 300, 220, ui.Color(0xFF77796F)),
  ];

  static final List<_Prop> props = [
    _Prop(-180, -66, 'car'),
    _Prop(320, -62, 'car'),
    _Prop(760, -66, 'car'),
    _Prop(1240, -62, 'car'),
    _Prop(-120, 968, 'car'),
    _Prop(420, 972, 'car'),
    _Prop(960, 968, 'car'),
    _Prop(1420, 972, 'car'),
    _Prop(-420, -70, 'palm'),
    _Prop(60, -70, 'palm'),
    _Prop(540, -70, 'palm'),
    _Prop(1020, -70, 'palm'),
    _Prop(1500, -70, 'palm'),
    _Prop(-300, 970, 'palm'),
    _Prop(220, 970, 'palm'),
    _Prop(700, 970, 'palm'),
    _Prop(1180, 970, 'palm'),
    _Prop(-660, 200, 'light'),
    _Prop(-140, 200, 'light'),
    _Prop(380, 200, 'light'),
    _Prop(900, 200, 'light'),
    _Prop(1420, 200, 'light'),
    _Prop(1940, 200, 'light'),
    _Prop(1940, 700, 'light'),
    _Prop(1420, 700, 'light'),
    _Prop(900, 700, 'light'),
    _Prop(380, 700, 'light'),
    _Prop(-140, 700, 'light'),
    _Prop(-660, 700, 'light'),
    _Prop(1640, -66, 'dumpster'),
    _Prop(40, 972, 'dumpster'),
  ];

  // ------------------------------------------------------------- lifecycle

  @override
  Future<void> onLoad() async {
    player = Fighter(0, 800, 406, VsPlayer.radius)
      ..maxHp = VsPlayer.maxHp
      ..hp = VsPlayer.maxHp
      ..speed = VsPlayer.speed
      ..energy = VsPlayer.energyMax;
    _buildDinerSign();
  }

  void _buildDinerSign() {
    const bounds = ui.Rect.fromLTWH(0, 0, 220, 56);
    final recorder = ui.PictureRecorder();
    final c = ui.Canvas(recorder, bounds);
    c.drawRect(
      bounds,
      ui.Paint()..color = const ui.Color(0xE0141416),
    );
    c.drawRect(
      const ui.Rect.fromLTWH(3, 3, 214, 50),
      ui.Paint()
        ..style = ui.PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = const ui.Color(0x88FF5A5A),
    );
    final tp = TextPainter(
      text: const TextSpan(
        text: 'DINER',
        style: TextStyle(
          color: ui.Color(0xFFFF5A5A),
          fontSize: 34,
          fontWeight: FontWeight.w900,
          letterSpacing: 6,
        ),
      ),
      textDirection: ui.TextDirection.ltr,
    );
    tp.layout();
    tp.paint(c, ui.Offset(110 - tp.width / 2, 28 - tp.height / 2));
    _dinerSign = recorder.endRecording();
  }

  // ----------------------------------------------------------- sim helpers

  void _spawnBot() {
    final sp = spawnPoints[spawnIdx % spawnPoints.length];
    spawnIdx++;
    final hp = VsBot.maxHp(wave);
    final b = Fighter(++nextId, sp[0], sp[1], VsBot.radius)
      ..maxHp = hp
      ..hp = hp
      ..speed = VsBot.speed(wave)
      ..waveN = wave;
    b.wpx = rng.nextDouble() * VsWorld.width;
    b.wpy = rng.nextDouble() * VsWorld.height;
    bots.add(b);
  }

  /// Drag-look: rotate the camera orbit (pixels).
  void rotateLook(double dxPixels) {
    camYaw -= dxPixels * 0.006;
    _manualAimTimer = _manualAimHold;
  }

  void noteManualAim() => _manualAimTimer = _manualAimHold;

  void aimFromWorld(double wx, double wy) {
    final dx = wx - player.x;
    final dy = wy - player.y;
    final l2 = dx * dx + dy * dy;
    if (l2 > 1e-6) {
      final d = math.sqrt(l2);
      aimX = dx / d;
      aimY = dy / d;
    }
  }

  @override
  void update(double dt) {
    super.update(dt);
    sceneT += dt;
    _acc += dt;
    var steps = 0;
    while (_acc >= VsWorld.dt && steps < 5) {
      _tick(VsWorld.dt);
      _acc -= VsWorld.dt;
      steps++;
    }
    if (steps >= 5) _acc = 0;
    _updateCosmetics(dt);
    _updateCamera(dt);
  }

  double _acc = 0;

  void _updateCamera(double dt) {
    final k = 1 - math.exp(-7 * dt);
    // Anchor leads slightly toward the aim so the framing feels GTA.
    final tx = player.x + aimX * 46;
    final ty = player.y + aimY * 46;
    camX += (tx - camX) * k;
    camY += (ty - camY) * k;
  }

  /// Render-layer animation: walk cycle, facing, flashes, rings.
  void _updateCosmetics(double dt) {
    player.initAnim();
    _animate(player, dt, aimX, aimY);
    for (final b in bots) {
      b.initAnim();
      var ax = 0.0, ay = 0.0;
      if (b.alive) {
        if (b.state == BotAiState.attack || b.state == BotAiState.chase) {
          ax = player.x - b.x;
          ay = player.y - b.y;
        } else if (math.sqrt(b.vx * b.vx + b.vy * b.vy) > 1) {
          ax = b.vx;
          ay = b.vy;
        }
      }
      _animate(b, dt, ax, ay);
      if (!b.alive && b.deathT < 2) b.deathT += dt;
    }
    for (var i = flashes.length - 1; i >= 0; i--) {
      flashes[i].life -= dt;
      if (flashes[i].life <= 0) flashes.removeAt(i);
    }
    for (var i = rings.length - 1; i >= 0; i--) {
      final r = rings[i];
      r.life -= dt;
      final t = 1 - (r.life / 0.45).clamp(0.0, 1.0);
      r.r = 8 + (r.maxR - 8) * math.sqrt(t);
      if (r.life <= 0) rings.removeAt(i);
    }
  }

  void _animate(Fighter f, double dt, double aimX2, double aimY2) {
    if (!f.alive) {
      f.stride += (0 - f.stride) * (1 - math.exp(-10 * dt));
      return;
    }
    final dx = f.x - f.lastX;
    final dy = f.y - f.lastY;
    final dist = math.sqrt(dx * dx + dy * dy);
    f.lastX = f.x;
    f.lastY = f.y;
    if (dist > 0.05) f.gait += dist;
    final speedRef = math.max(1.0, f.speed * dt);
    final moveAmt = math.min(1.0, dist / speedRef);
    f.stride += (moveAmt - f.stride) * (1 - math.exp(-14 * dt));

    // Smoothed world facing toward the aim (or travel) direction.
    var tx = aimX2, ty = aimY2;
    if (tx * tx + ty * ty < 1e-6) {
      tx = f.vx;
      ty = f.vy;
    }
    if (tx * tx + ty * ty > 1e-6) {
      final target = math.atan2(tx, -ty);
      var d = target - f.yaw;
      while (d > math.pi) {
        d -= 2 * math.pi;
      }
      while (d < -math.pi) {
        d += 2 * math.pi;
      }
      f.yaw += d * (1 - math.exp(-14 * dt));
    }
  }

  void _tick(double dt) {
    if (matchOver) return;
    elapsed += dt;

    // timers
    if (combo > 1) {
      comboTimer -= dt;
      if (comboTimer <= 0) combo = 1;
    }
    for (final f in [player, ...bots]) {
      if (f.fireCd > 0) f.fireCd -= dt;
    }
    if (player.dashCd > 0) player.dashCd -= dt;
    if (spawnTimer > 0) spawnTimer -= dt;
    if (_manualAimTimer > 0) _manualAimTimer -= dt;

    // player movement + aim + firing
    if (player.alive) {
      player.energy = math.min(
          VsPlayer.energyMax, player.energy + VsPlayer.energyRegen * dt);

      // Camera-relative movement: stick up = walk where the camera looks.
      final fx = math.sin(camYaw), fy = -math.cos(camYaw);
      final rx = math.cos(camYaw), ry = math.sin(camYaw);
      final fwd = -moveY;
      final wx = fx * fwd + rx * moveX;
      final wy = fy * fwd + ry * moveX;
      _applyMovement(player, wx, wy, 1.0, dt);

      // Aim: camera forward; soft-snap to a visible bot in a ~15° cone.
      var ax = fx, ay = fy;
      final aimV = _assistTarget(fx, fy);
      if (aimV != null) {
        ax = aimV[0];
        ay = aimV[1];
      }
      aimX = ax;
      aimY = ay;

      if (firing && player.fireCd <= 0 && player.energy >= VsRifle.energyCost) {
        _fireProjectile(player, aimX, aimY, true, 0);
        player.fireCd = VsRifle.fireInterval;
        player.energy -= VsRifle.energyCost;
      }
      if (dashQueued) {
        dashQueued = false;
        if (player.dashCd <= 0) {
          final l = math.sqrt(wx * wx + wy * wy);
          final dx = l > 1e-6 ? wx / l : aimX;
          final dy = l > 1e-6 ? wy / l : aimY;
          player.vx += dx * VsPlayer.dashImpulse;
          player.vy += dy * VsPlayer.dashImpulse;
          player.dashCd = VsPlayer.dashCooldown;
        }
      }
      if (novaQueued) {
        novaQueued = false;
        if (player.energy >= VsNova.energyCost) {
          player.energy -= VsNova.energyCost;
          rings.add(GroundRing(player.x, player.y, VsNova.radius,
              const ui.Color(0x99C8F31D)));
          for (final b in bots.where((b) => b.alive)) {
            final dx = b.x - player.x, dy = b.y - player.y;
            final d = math.sqrt(dx * dx + dy * dy);
            if (d <= VsNova.radius) {
              b.hp -= VsNova.damage;
              b.vx += (dx / (d < 1 ? 1 : d)) * VsNova.knockback;
              b.vy += (dy / (d < 1 ? 1 : d)) * VsNova.knockback;
            }
          }
        }
      }
    }

    // bots
    for (final b in bots) {
      if (!b.alive) continue;
      _updateBot(b, dt);
    }

    // projectiles
    for (final p in bullets) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.fromPlayer) {
        for (final b in bots.where((b) => b.alive)) {
          final dx = p.x - b.x, dy = p.y - b.y;
          if (dx * dx + dy * dy <
              (p.radius + b.radius) * (p.radius + b.radius)) {
            b.hp -= VsRifle.damage;
            p.life = 0;
            break;
          }
        }
      } else if (player.alive) {
        final dx = p.x - player.x, dy = p.y - player.y;
        if (dx * dx + dy * dy <
            (p.radius + player.radius) * (p.radius + player.radius)) {
          player.hp -= VsBot.damage;
          p.life = 0;
        }
      }
    }
    bullets.removeWhere((p) => p.life <= 0);

    // deaths
    for (final b in bots) {
      if (b.alive && b.hp <= 0) {
        b.alive = false;
        b.deathT = 0;
        score += 100 * combo;
        kills++;
        combo = (combo < 5) ? combo + 1 : combo;
        comboTimer = 3.0;
        rings.add(GroundRing(b.x, b.y, 70, const ui.Color(0x99FF3D5A)));
      }
    }
    if (player.alive && player.hp <= 0) {
      player.alive = false;
      player.deathT = 0;
      matchOver = true;
      onMatchOver(MatchResult(score, kills, wave, elapsed.round()));
      return;
    }

    // wave director
    if (wavePending > 0 && spawnTimer <= 0) {
      _spawnBot();
      wavePending--;
      spawnTimer = VsBot.spawnStagger;
    }
    if (wavePending == 0 && bots.every((b) => !b.alive)) {
      score += 250 + 50 * wave;
      wave++;
      wavePending = VsBot.countFor(wave);
      spawnTimer = VsBot.spawnStagger;
    }
  }

  /// Aim assist: nearest visible bot within a 15° cone of the camera.
  List<double>? _assistTarget(double fx, double fy) {
    List<double>? best;
    var bestScore = -1.0;
    for (final b in bots) {
      if (!b.alive) continue;
      final dx = b.x - player.x, dy = b.y - player.y;
      final d = math.sqrt(dx * dx + dy * dy);
      if (d < 40 || d > 900) continue;
      final ux = dx / d, uy = dy / d;
      final dot = ux * fx + uy * fy;
      if (dot < math.cos(0.28)) continue; // outside the cone
      if (!_los(player.x, player.y, b.x, b.y)) continue;
      if (dot > bestScore) {
        bestScore = dot;
        best = [ux, uy];
      }
    }
    return best;
  }

  void _fireProjectile(
      Fighter from, double dx, double dy, bool fromPlayer, int waveN) {
    final jitter = ((rng.nextDouble() * 2 - 1) *
            (fromPlayer ? VsRifle.spreadDeg : VsBot.jitterDeg(waveN))) *
        math.pi /
        180;
    final c = math.cos(jitter), s = math.sin(jitter);
    final rx = dx * c - dy * s, ry = dx * s + dy * c;
    final mx = from.x + rx * (from.radius + 6);
    final my = from.y + ry * (from.radius + 6);
    bullets.add(Bullet(
      mx,
      my,
      rx * (fromPlayer ? VsRifle.projectileSpeed : VsBot.projectileSpeed),
      ry * (fromPlayer ? VsRifle.projectileSpeed : VsBot.projectileSpeed),
      fromPlayer,
    ));
    flashes.add(Flash(mx, my, rx, ry, fromPlayer));
    if (flashes.length > 16) flashes.removeAt(0);
  }

  void _updateBot(Fighter b, double dt) {
    final pdx = player.x - b.x, pdy = player.y - b.y;
    final dist = math.sqrt(pdx * pdx + pdy * pdy);
    b.stateTimer -= dt;
    if (b.stateTimer <= 0) {
      b.stateTimer = 0.25;
      if (b.hp < 0.25 * b.maxHp) {
        b.state = BotAiState.flee;
      } else if (dist < 420 && _los(b.x, b.y, player.x, player.y)) {
        b.state = BotAiState.attack;
      } else if (dist < 260) {
        b.state = BotAiState.strafe;
      } else if (dist < 520) {
        b.state = BotAiState.chase;
      } else {
        b.state = BotAiState.patrol;
      }
      if (b.state == BotAiState.strafe || b.state == BotAiState.attack) {
        b.orbitSign = rng.nextBool() ? 1 : -1;
      }
    }

    double mx = 0, my = 0;
    switch (b.state) {
      case BotAiState.patrol:
        b.waypointTimer -= dt;
        final wd = math.sqrt(
            (b.wpx - b.x) * (b.wpx - b.x) + (b.wpy - b.y) * (b.wpy - b.y));
        if (b.waypointTimer <= 0 || wd < 20) {
          b.wpx = rng.nextDouble() * VsWorld.width;
          b.wpy = rng.nextDouble() * VsWorld.height;
          b.waypointTimer = 4;
        }
        mx = b.wpx - b.x;
        my = b.wpy - b.y;
      case BotAiState.chase:
        mx = pdx;
        my = pdy;
      case BotAiState.strafe:
      case BotAiState.attack:
        mx = -pdy * b.orbitSign;
        my = pdx * b.orbitSign;
      case BotAiState.flee:
        mx = -pdx;
        my = -pdy;
    }
    _applyMovement(
        b, mx, my, b.state == BotAiState.strafe || b.state == BotAiState.attack ? 0.6 : 1.0,
        dt);

    if (b.state == BotAiState.attack &&
        b.fireCd <= 0 &&
        dist < 420 &&
        _los(b.x, b.y, player.x, player.y) &&
        player.alive) {
      _fireProjectile(b, pdx / dist, pdy / dist, false, b.waveN);
      b.fireCd = VsBot.fireInterval;
    }
  }

  void _applyMovement(Fighter f, double mx, double my, double mul, double dt) {
    final l = math.sqrt(mx * mx + my * my);
    double tx = 0, ty = 0;
    if (l > 1e-6) {
      tx = (mx / l) * f.speed * mul;
      ty = (my / l) * f.speed * mul;
    }
    f.vx += (tx - f.vx) * 0.2;
    f.vy += (ty - f.vy) * 0.2;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    _resolveBounds(f);
  }

  void _resolveBounds(Fighter f) {
    if (f.x < f.radius) f.x = f.radius;
    if (f.x > VsWorld.width - f.radius) f.x = VsWorld.width - f.radius;
    if (f.y < f.radius) f.y = f.radius;
    if (f.y > VsWorld.height - f.radius) f.y = VsWorld.height - f.radius;
    for (final ob in obstacles) {
      final cx = f.x.clamp(ob[0], ob[0] + ob[2]);
      final cy = f.y.clamp(ob[1], ob[1] + ob[3]);
      final dx = f.x - cx, dy = f.y - cy;
      final d2 = dx * dx + dy * dy;
      if (d2 < f.radius * f.radius && d2 > 1e-12) {
        final d = math.sqrt(d2);
        f.x += dx / d * (f.radius - d);
        f.y += dy / d * (f.radius - d);
      }
    }
  }

  bool _los(double x1, double y1, double x2, double y2) {
    for (final ob in obstacles) {
      if (_segVsBox(x1, y1, x2, y2, ob)) return false;
    }
    return true;
  }

  bool _segVsBox(double x1, double y1, double x2, double y2, List<double> b) {
    double tmin = 0, tmax = 1;
    final dx = x2 - x1, dy = y2 - y1;
    if (dx.abs() < 1e-12) {
      if (x1 < b[0] || x1 > b[0] + b[2]) return false;
    } else {
      var t1 = (b[0] - x1) / dx, t2 = (b[0] + b[2] - x1) / dx;
      if (t1 > t2) {
        final t = t1;
        t1 = t2;
        t2 = t;
      }
      tmin = tmin > t1 ? tmin : t1;
      tmax = tmax < t2 ? tmax : t2;
      if (tmin > tmax) return false;
    }
    if (dy.abs() < 1e-12) {
      if (y1 < b[1] || y1 > b[1] + b[3]) return false;
    } else {
      var t1 = (b[1] - y1) / dy, t2 = (b[1] + b[3] - y1) / dy;
      if (t1 > t2) {
        final t = t1;
        t1 = t2;
        t2 = t;
      }
      tmin = tmin > t1 ? tmin : t1;
      tmax = tmax < t2 ? tmax : t2;
      if (tmin > tmax) return false;
    }
    return true;
  }

  // ------------------------------------------------------- pseudo-3D camera

  double _horizonY = 0;
  double _focal = 500;
  double _cx = 0;

  /// World-space camera basis: forward (sin yaw, -cos yaw), right (cos, sin).
  double get _fwdX => math.sin(camYaw);
  double get _fwdY => -math.cos(camYaw);
  double get _rgtX => math.cos(camYaw);
  double get _rgtY => math.sin(camYaw);

  /// Depth of a world point from the camera plane (<= 0 → behind camera).
  double depthOf(double wx, double wy) {
    final rx = wx - camX, ry = wy - camY;
    return rx * _fwdX + ry * _fwdY + kCamDist;
  }

  /// Project a world point onto the screen (ground plane).
  ui.Offset project(double wx, double wy) {
    final rx = wx - camX, ry = wy - camY;
    final fwd = rx * _fwdX + ry * _fwdY;
    final rgt = rx * _rgtX + ry * _rgtY;
    final d = fwd + kCamDist;
    final s = _focal / math.max(d, 1.0);
    return ui.Offset(_cx + rgt * s, _horizonY + kEyeH * s);
  }

  /// Project a world point at a given height above the street.
  ui.Offset projectAt(double wx, double wy, double h) {
    final rx = wx - camX, ry = wy - camY;
    final fwd = rx * _fwdX + ry * _fwdY;
    final rgt = rx * _rgtX + ry * _rgtY;
    final d = fwd + kCamDist;
    final s = _focal / math.max(d, 1.0);
    return ui.Offset(_cx + rgt * s, _horizonY + (kEyeH - h) * s);
  }

  /// Screen scale (px per world unit) at a world point.
  double scaleAt(double wx, double wy) =>
      _focal / math.max(depthOf(wx, wy), 1.0);

  /// Widget-space point → world-space point (screen ray onto the ground).
  ui.Offset screenToWorld(ui.Offset local) {
    final dy = local.dy - _horizonY;
    if (dy <= 1) {
      // Sky: aim far ahead along the view direction.
      return ui.Offset(
        player.x + _fwdX * 900,
        player.y + _fwdY * 900,
      );
    }
    final d = kEyeH * _focal / dy;
    final s = _focal / d;
    final rgt = (local.dx - _cx) / s;
    final fwd = d - kCamDist;
    return ui.Offset(
      player.x + _rgtX * rgt + _fwdX * fwd,
      player.y + _rgtY * rgt + _fwdY * fwd,
    );
  }

  // ------------------------------------------------------------- rendering

  @override
  void render(ui.Canvas canvas) {
    _cx = size.x / 2;
    _horizonY = size.y * kHorizonFrac;
    _focal = size.y * 0.66;

    _renderSky(canvas);
    _renderGround(canvas);

    // Depth-sorted world: far → near.
    final items = <_Item>[];
    for (final b in buildings) {
      items.add(_Item(depthOf(b.x + b.w / 2, b.y + b.d / 2), building: b));
    }
    for (var i = 0; i < obstacles.length; i++) {
      final o = obstacles[i];
      items.add(_Item(depthOf(o[0] + o[2] / 2, o[1] + o[3] / 2), cover: i));
    }
    for (final p in props) {
      items.add(_Item(depthOf(p.x, p.y), prop: p));
    }
    for (final b in bots) {
      items.add(_Item(depthOf(b.x, b.y), bot: b));
    }
    items.add(_Item(depthOf(player.x, player.y), isPlayer: true));
    for (final p in bullets) {
      items.add(_Item(depthOf(p.x, p.y), bullet: p));
    }
    for (final f in flashes) {
      items.add(_Item(depthOf(f.x, f.y), flash: f));
    }
    for (final r in rings) {
      items.add(_Item(depthOf(r.x, r.y), ring: r));
    }
    items.sort((a, b) => b.depth.compareTo(a.depth));

    for (final it in items) {
      final b = it.building;
      if (b != null) {
        _drawBuilding(canvas, b);
      } else if (it.cover != null) {
        _drawCover(canvas, obstacles[it.cover!], it.cover!);
      } else if (it.prop != null) {
        _drawProp(canvas, it.prop!);
      } else if (it.bot != null) {
        _drawFigure(canvas, it.bot!, isPlayer: false);
      } else if (it.isPlayer) {
        _drawFigure(canvas, player, isPlayer: true);
      } else if (it.bullet != null) {
        _drawTracer(canvas, it.bullet!);
      } else if (it.flash != null) {
        _drawFlash(canvas, it.flash!);
      } else if (it.ring != null) {
        _drawRing(canvas, it.ring!);
      }
    }
  }

  void _renderSky(ui.Canvas canvas) {
    final skyRect = ui.Rect.fromLTWH(0, 0, size.x, _horizonY + 1);
    final sunX = _cx - math.sin(camYaw) * size.x * 0.9;
    final paint = ui.Paint()
      ..shader = ui.Gradient.linear(
        ui.Offset(0, 0),
        ui.Offset(0, _horizonY),
        [
          const ui.Color(0xFF2C4A6E),
          const ui.Color(0xFF8FA6BC),
          const ui.Color(0xFFE8B06A),
          const ui.Color(0xFFF2C883),
        ],
        [0.0, 0.45, 0.78, 1.0],
      );
    canvas.drawRect(skyRect, paint);
    // Sun glow.
    final glow = ui.Paint()
      ..shader = ui.Gradient.radial(
        ui.Offset(sunX, _horizonY * 0.42),
        size.x * 0.22,
        [
          const ui.Color(0xCCFFEFC4),
          const ui.Color(0x00FFEFC4),
        ],
      );
    canvas.drawRect(skyRect, glow);
    // Distant skyline silhouette (slight yaw parallax).
    final sil = ui.Paint()..color = const ui.Color(0x59514A58);
    final base = _horizonY + 1;
    final off = -math.sin(camYaw) * 60;
    for (var i = 0; i < 12; i++) {
      final bw = size.x * 0.09;
      final bh = 26.0 + (i * 37 % 70);
      final bx = ((i * bw * 1.12) + off) % (size.x + bw) - bw;
      canvas.drawRect(ui.Rect.fromLTWH(bx, base - bh, bw, bh), sil);
    }
    // Haze band.
    canvas.drawRect(
      ui.Rect.fromLTWH(0, _horizonY - 14, size.x, 15),
      ui.Paint()..color = const ui.Color(0x66E8B06A),
    );
  }

  void _renderGround(ui.Canvas canvas) {
    final groundRect = ui.Rect.fromLTWH(0, _horizonY, size.x, size.y - _horizonY);
    canvas.drawRect(
      groundRect,
      ui.Paint()..color = const ui.Color(0xFF2B2D2F),
    );

    // Sidewalk bands (outside the play bounds).
    _drawGroundQuad(canvas, -2200, -1040, 4400, 1024, const ui.Color(0xFF8F8C83));
    _drawGroundQuad(canvas, -2200, 906, 4400, 1024, const ui.Color(0xFF8F8C83));
    // Curb shading lines.
    _drawGroundQuad(canvas, -2200, -10, 4400, 5, const ui.Color(0xFF7C7A72));
    _drawGroundQuad(canvas, -2200, 905, 4400, 5, const ui.Color(0xFF7C7A72));

    // Lane dashes (three lanes each way).
    for (final laneY in const [150.0, 300.0, 600.0, 750.0]) {
      for (double x = -720; x <= 1560; x += 90) {
        _drawGroundQuad(canvas, x, laneY - 2, 38, 4, const ui.Color(0xBBD8D4C2));
      }
    }
    // Double-yellow center line.
    _drawGroundQuad(canvas, -780, 445, 3160, 4, const ui.Color(0x99C9A93A));
    _drawGroundQuad(canvas, -780, 453, 3160, 4, const ui.Color(0x99C9A93A));
    // Crosswalks near both ends.
    for (final cx0 in const [80.0, 1380.0]) {
      for (var i = 0; i < 7; i++) {
        _drawGroundQuad(
            canvas, cx0 + i * 20, -180, 10, 380, const ui.Color(0x99E2DED0));
      }
    }
    // Manholes.
    for (final m in const [
      [300.0, 380.0],
      [1100.0, 520.0],
      [700.0, 250.0],
    ]) {
      _drawGroundQuad(canvas, m[0], m[1], 10, 10, const ui.Color(0xFF1D1F21));
    }
  }

  /// Fill a ground-space quad (x, y, w, d in world units) with perspective.
  void _drawGroundQuad(
      ui.Canvas canvas, double x, double y, double w, double d, ui.Color c) {
    final path = _clippedPoly([
      _toV(x, y, 0),
      _toV(x + w, y, 0),
      _toV(x + w, y + d, 0),
      _toV(x, y + d, 0),
    ]);
    if (path != null) canvas.drawPath(path, ui.Paint()..color = c);
  }

  /// Camera-space vertex: right offset, forward offset, height above street.
  _V _toV(double wx, double wy, double h) {
    final rx = wx - camX, ry = wy - camY;
    return _V(rx * _rgtX + ry * _rgtY, rx * _fwdX + ry * _fwdY, h);
  }

  /// Clip a world polygon against the camera near plane and project it.
  /// Returns null when fully clipped.
  ui.Path? _clippedPoly(List<_V> verts) {
    const near = -kCamDist + 2.0;
    final out = <_V>[];
    for (var i = 0; i < verts.length; i++) {
      final a = verts[i], b = verts[(i + 1) % verts.length];
      final ain = a.fwd >= near, bin = b.fwd >= near;
      if (ain) out.add(a);
      if (ain != bin) {
        final t = (near - a.fwd) / (b.fwd - a.fwd);
        out.add(_V(
          a.rgt + (b.rgt - a.rgt) * t,
          near,
          a.h + (b.h - a.h) * t,
        ));
      }
    }
    if (out.length < 3) return null;
    final path = ui.Path();
    for (var i = 0; i < out.length; i++) {
      final v = out[i];
      final s = _focal / (v.fwd + kCamDist);
      final sx = _cx + v.rgt * s;
      final sy = _horizonY + (kEyeH - v.h) * s;
      if (i == 0) {
        path.moveTo(sx, sy);
      } else {
        path.lineTo(sx, sy);
      }
    }
    path.close();
    return path;
  }

  /// Extruded box: footprint (x, y, w, d), height h. Near-plane clipped,
  /// camera-facing side walls only.
  void _drawBox(ui.Canvas canvas, double x, double y, double w, double d,
      double h, ui.Color base, {bool windows = false}) {
    final dNear = depthOf(x + w / 2, y + d / 2);
    if (dNear < -140) return; // fully behind the camera

    // Side faces — draw only the ones facing the camera.
    void faceWall(
        double ax, double ay, double bx, double by, ui.Color col) {
      // Outward normal of the wall segment A→B.
      final nx = (by - ay), ny = -(bx - ax);
      final mxw = (ax + bx) / 2, myw = (ay + by) / 2;
      if (nx * (camX - mxw) + ny * (camY - myw) <= 0) return;
      final path = _clippedPoly([
        _toV(ax, ay, h),
        _toV(bx, by, h),
        _toV(bx, by, 0),
        _toV(ax, ay, 0),
      ]);
      if (path == null) return;
      canvas.drawPath(path, ui.Paint()..color = col);
      if (windows) {
        // Window bands across the facade (cheap detail).
        final bandPaint = ui.Paint()..color = const ui.Color(0x55202830);
        final rows = (h / 46).floor().clamp(1, 6);
        for (var rI = 0; rI < rows; rI++) {
          final h0 = h * (rI + 0.45) / rows;
          final h1 = h * (rI + 0.75) / rows;
          final band = _clippedPoly([
            _toV(ax, ay, h0),
            _toV(bx, by, h0),
            _toV(bx, by, h1),
            _toV(ax, ay, h1),
          ]);
          if (band != null) canvas.drawPath(band, bandPaint);
        }
      }
    }

    faceWall(x, y, x + w, y, _shade(base, 1.06)); // north
    faceWall(x + w, y, x + w, y + d, _shade(base, 0.82)); // east
    faceWall(x + w, y + d, x, y + d, _shade(base, 0.9)); // south
    faceWall(x, y + d, x, y, _shade(base, 0.78)); // west
    // Top face.
    final top = _clippedPoly([
      _toV(x, y, h),
      _toV(x + w, y, h),
      _toV(x + w, y + d, h),
      _toV(x, y + d, h),
    ]);
    if (top != null) {
      canvas.drawPath(top, ui.Paint()..color = _shade(base, 1.18));
      canvas.drawPath(
          top,
          ui.Paint()
            ..color = const ui.Color(0x33111111)
            ..style = ui.PaintingStyle.stroke
            ..strokeWidth = 1);
    }
  }

  ui.Color _shade(ui.Color c, double k) {
    return ui.Color.fromARGB(
      c.alpha,
      (c.red * k).clamp(0, 255).toInt(),
      (c.green * k).clamp(0, 255).toInt(),
      (c.blue * k).clamp(0, 255).toInt(),
    );
  }

  void _drawBuilding(ui.Canvas canvas, _Building b) {
    _drawBox(canvas, b.x, b.y, b.w, b.d, b.h, b.tint);
    // Roof clutter.
    if (b.h > 200) {
      _drawBox(canvas, b.x + b.w * 0.2, b.y + b.d * 0.3, 30, 22, b.h + 12,
          const ui.Color(0xFF8E9094));
    }
  }

  void _drawCover(ui.Canvas canvas, List<double> o, int idx) {
    final x = o[0], y = o[1], w = o[2], d = o[3];
    if (idx == 3) {
      // Abandoned diner — exact footprint, neon roof sign.
      _drawBox(canvas, x, y, w, d, 68, const ui.Color(0xFF9C8E76));
      // Boarded window bands on the long faces.
      _drawGroundQuad(canvas, x + 8, y - 1, 60, 2, const ui.Color(0xFF6B543A));
      // Sign billboard above the roof.
      if (_dinerSign != null) {
        final s = scaleAt(x + w / 2, y + d / 2);
        final top = projectAt(x + w / 2, y + d / 2, 96);
        final wpx = 220 * s * 0.55;
        final hpx = 56 * s * 0.55;
        canvas.save();
        canvas.translate(top.dx - wpx / 2, top.dy - hpx / 2);
        canvas.scale(wpx / 220, hpx / 56);
        canvas.drawPicture(_dinerSign!);
        canvas.restore();
      }
      return;
    }
    // Brick cover wall — exact footprint.
    _drawBox(canvas, x, y, w, d, 44, const ui.Color(0xFF63432F));
    // Steel patch.
    _drawBox(canvas, x + w * 0.18, y - 1, w * 0.3, 3, 30,
        const ui.Color(0xFF4C5157));
  }

  void _drawProp(ui.Canvas canvas, _Prop p) {
    final d = depthOf(p.x, p.y);
    if (d < 60 || d > 2600) return;
    final s = _focal / d;
    final base = project(p.x, p.y);
    switch (p.kind) {
      case 'palm':
        final top = projectAt(p.x, p.y, 105);
        final trunk = ui.Paint()
          ..color = const ui.Color(0xFF7A5B3A)
          ..strokeWidth = (3.4 * s).clamp(1.2, 9)
          ..strokeCap = ui.StrokeCap.round;
        canvas.drawLine(base, top, trunk);
        final frond = ui.Paint()..color = const ui.Color(0xFF3F7A3C);
        for (var i = 0; i < 6; i++) {
          final a = (i / 6) * math.pi * 2 + 0.4;
          final fr = 15 * s;
          final fx = top.dx + math.cos(a) * fr;
          final fy = top.dy + math.sin(a) * fr * 0.5 - 4 * s;
          canvas.drawLine(
            top,
            ui.Offset(fx, fy),
            ui.Paint()
              ..color = frond.color
              ..strokeWidth = (3 * s).clamp(1, 7)
              ..strokeCap = ui.StrokeCap.round,
          );
        }
      case 'light':
        final top = projectAt(p.x, p.y, 95);
        final pole = ui.Paint()
          ..color = const ui.Color(0xFF3C4046)
          ..strokeWidth = (2.4 * s).clamp(1, 6);
        canvas.drawLine(base, top, pole);
        final glow = ui.Paint()
          ..shader = ui.Gradient.radial(
            top,
            22 * s,
            [
              const ui.Color(0xCCFFE6B0),
              const ui.Color(0x00FFE6B0),
            ],
          );
        canvas.drawCircle(top, 22 * s, glow);
      case 'car':
        _drawBox(canvas, p.x - 17, p.y - 39, 34, 78, 9,
            const ui.Color(0xFF7D3328));
        _drawBox(canvas, p.x - 15, p.y - 24, 30, 34, 17,
            const ui.Color(0xFF22262B));
      case 'dumpster':
        _drawBox(canvas, p.x - 20, p.y - 10, 40, 20, 18,
            const ui.Color(0xFF2E4A38));
    }
  }

  void _drawFigure(ui.Canvas canvas, Fighter f, {required bool isPlayer}) {
    final d = depthOf(f.x, f.y);
    if (d < 40) return;
    final s = _focal / d;
    if (s * 40 < 2) return; // too far to matter

    final base = project(f.x, f.y);
    var alpha = 1.0;
    var sink = 0.0;
    if (!f.alive) {
      final t = f.deathT.clamp(0.0, 2.0);
      if (t > 1.3) return;
      alpha = t < 0.9 ? 1.0 : 1 - (t - 0.9) / 0.4;
      sink = math.min(t, 0.5) * 6;
    }

    // Contact shadow.
    canvas.drawOval(
      ui.Rect.fromCenter(
        center: ui.Offset(base.dx, base.dy - s),
        width: 26 * s,
        height: 9 * s,
      ),
      ui.Paint()..color = const ui.Color(0x59000000),
    );

    final H = kFigureH * s;
    final bodyW = 11 * s;
    final legH = H * 0.42;
    final torsoH = H * 0.4;
    final headR = H * 0.115;
    final cy = base.dy - sink;

    // Facing relative to the camera.
    var rel = f.yaw - camYaw;
    while (rel > math.pi) {
      rel -= 2 * math.pi;
    }
    while (rel < -math.pi) {
      rel += 2 * math.pi;
    }
    final absRel = rel.abs();
    final back = absRel < math.pi / 3;
    final front = absRel > 2 * math.pi / 3;
    final sideSign = rel >= 0 ? 1 : -1;

    final jacket = isPlayer ? const ui.Color(0xFF20242A) : const ui.Color(0xFF8C2733);
    final jacketDark = isPlayer ? const ui.Color(0xFF14171B) : const ui.Color(0xFF5C1A23);
    final pants = isPlayer ? const ui.Color(0xFF262B33) : const ui.Color(0xFF23252B);
    final shoes = isPlayer ? const ui.Color(0xFFE4E2DA) : const ui.Color(0xFF2E3033);
    final skin = isPlayer ? const ui.Color(0xFFB98A63) : const ui.Color(0xFFA97A55);
    final hat = isPlayer ? const ui.Color(0xFF121316) : const ui.Color(0xFF4D151D);
    final accent = isPlayer ? const ui.Color(0xFFC8F31D) : const ui.Color(0xFFFF3D5A);

    final pPaint = (ui.Color c, [double? a]) => ui.Paint()
      ..color = c.withValues(alpha: (a ?? 1.0) * alpha);

    // Legs.
    final phase = (f.gait / 30) * math.pi * 2;
    final swing = f.stride;
    if (back || front) {
      final l1 = legH * (1 + 0.10 * math.sin(phase) * swing);
      final l2 = legH * (1 + 0.10 * math.sin(phase + math.pi) * swing);
      canvas.drawRRect(
        ui.RRect.fromRectAndRadius(
          ui.Rect.fromLTWH(base.dx - bodyW * 0.42, cy - l1, bodyW * 0.36, l1),
          ui.Radius.circular(2 * s),
        ),
        pPaint(pants),
      );
      canvas.drawRRect(
        ui.RRect.fromRectAndRadius(
          ui.Rect.fromLTWH(base.dx + bodyW * 0.06, cy - l2, bodyW * 0.36, l2),
          ui.Radius.circular(2 * s),
        ),
        pPaint(pants),
      );
      canvas.drawRect(
        ui.Rect.fromLTWH(base.dx - bodyW * 0.44, cy - 2.4 * s, bodyW * 0.4, 2.4 * s),
        pPaint(shoes),
      );
      canvas.drawRect(
        ui.Rect.fromLTWH(base.dx + bodyW * 0.04, cy - 2.4 * s, bodyW * 0.4, 2.4 * s),
        pPaint(shoes),
      );
    } else {
      final lswing = 10 * s * swing;
      // Back leg (shaded) + front leg, swinging opposite.
      canvas.drawRRect(
        ui.RRect.fromRectAndRadius(
          ui.Rect.fromLTWH(base.dx - bodyW * 0.24 - lswing * sideSign,
              cy - legH, bodyW * 0.34, legH),
          ui.Radius.circular(2 * s),
        ),
        pPaint(pants, 0.78),
      );
      canvas.drawRRect(
        ui.RRect.fromRectAndRadius(
          ui.Rect.fromLTWH(base.dx - bodyW * 0.24 + lswing * sideSign,
              cy - legH, bodyW * 0.34, legH),
          ui.Radius.circular(2 * s),
        ),
        pPaint(pants),
      );
    }

    // Torso.
    final torsoTop = cy - legH - torsoH;
    canvas.drawRRect(
      ui.RRect.fromRectAndRadius(
        ui.Rect.fromLTWH(
            base.dx - bodyW / 2, torsoTop, bodyW, torsoH + 2 * s),
        ui.Radius.circular(2.6 * s),
      ),
      pPaint(jacket),
    );
    if (back) {
      // Volt accent stripe + backpack (seen from behind).
      canvas.drawRect(
        ui.Rect.fromLTWH(base.dx - bodyW / 2, torsoTop + torsoH * 0.28, bodyW, 1.6 * s),
        pPaint(accent),
      );
      canvas.drawRRect(
        ui.RRect.fromRectAndRadius(
          ui.Rect.fromLTWH(
              base.dx - bodyW * 0.3, torsoTop + torsoH * 0.12, bodyW * 0.6, torsoH * 0.62),
          ui.Radius.circular(2 * s),
        ),
        pPaint(jacketDark),
      );
    }

    // Head.
    final headCy = torsoTop - headR * 0.9;
    canvas.drawCircle(ui.Offset(base.dx, headCy), headR, pPaint(skin));
    canvas.drawArc(
      ui.Rect.fromCircle(center: ui.Offset(base.dx, headCy), radius: headR),
      math.pi,
      math.pi,
      true,
      pPaint(hat),
    );
    if (front) {
      canvas.drawRect(
        ui.Rect.fromLTWH(base.dx - headR * 0.7, headCy - headR * 0.15,
            headR * 1.4, headR * 0.42),
        pPaint(const ui.Color(0xFF0C0D10)),
      );
    }

    // Rifle toward the aim (screen-space projection of the aim vector).
    final gunPaint = ui.Paint()
      ..color = const ui.Color(0xFF15171B)
      ..strokeWidth = 2.6 * s
      ..strokeCap = ui.StrokeCap.round;
    final shoulder =
        ui.Offset(base.dx + sideSign * bodyW * 0.3, torsoTop + torsoH * 0.25);
    if (!front) {
      final dirX = math.sin(f.yaw - camYaw);
      final gl = 15 * s;
      final end = ui.Offset(
        shoulder.dx + (dirX.abs() < 0.25 ? sideSign * 0.3 : dirX) * gl,
        shoulder.dy + 2 * s,
      );
      canvas.drawLine(shoulder, end, gunPaint);
      canvas.drawCircle(shoulder, 2.2 * s, pPaint(skin));
      canvas.drawCircle(end, 2.0 * s, pPaint(skin));
    } else {
      // Weapon held across the chest, pointing at the camera.
      canvas.drawLine(
        shoulder,
        ui.Offset(shoulder.dx - sideSign * 10 * s, shoulder.dy + 4 * s),
        gunPaint,
      );
    }

    // HP bar above the head (hostiles only, when damaged).
    if (!isPlayer && f.alive && f.hp < f.maxHp) {
      const bw = 34.0;
      final frac = (f.hp / f.maxHp).clamp(0.0, 1.0);
      final barY = headCy - headR - 8 * s;
      canvas.drawRect(
        ui.Rect.fromLTWH(base.dx - bw / 2, barY, bw, 3.4 * s.clamp(0.8, 1.6)),
        ui.Paint()..color = const ui.Color(0x33FFFFFF),
      );
      canvas.drawRect(
        ui.Rect.fromLTWH(base.dx - bw / 2, barY, bw * frac, 3.4 * s.clamp(0.8, 1.6)),
        ui.Paint()..color = const ui.Color(0xFFFF3D5A),
      );
    }
  }

  void _drawTracer(ui.Canvas canvas, Bullet p) {
    final d = depthOf(p.x, p.y);
    if (d < 30) return;
    final s = _focal / d;
    final a = projectAt(p.x - p.vx * 0.028, p.y - p.vy * 0.028, kChestH);
    final b = projectAt(p.x, p.y, kChestH);
    canvas.drawLine(
      a,
      b,
      ui.Paint()
        ..color = (p.fromPlayer ? const ui.Color(0xFFD6FF45) : const ui.Color(0xFFFF4D68))
            .withValues(alpha: 0.9)
        ..strokeWidth = (2.6 * s).clamp(1.2, 5)
        ..strokeCap = ui.StrokeCap.round,
    );
  }

  void _drawFlash(ui.Canvas canvas, Flash f) {
    final d = depthOf(f.x, f.y);
    if (d < 30) return;
    final s = _focal / d;
    final pos = projectAt(f.x, f.y, kChestH + 2);
    final k = f.life / 0.07;
    final r = (11 + 13 * k) * s;
    canvas.drawCircle(
      pos,
      r,
      ui.Paint()
        ..shader = ui.Gradient.radial(pos, r, [
          ui.Color.fromARGB((220 * k).round(), 255, 250, 224),
          ui.Color.fromARGB(0, 228, 255, 112),
        ]),
    );
  }

  void _drawRing(ui.Canvas canvas, GroundRing r) {
    final paint = ui.Paint()
      ..color = r.color.withValues(alpha: (r.life / 0.45).clamp(0.0, 1.0) * 0.8)
      ..style = ui.PaintingStyle.stroke
      ..strokeWidth = 2.5;
    var penDown = false;
    var prev = ui.Offset.zero;
    for (var i = 0; i <= 24; i++) {
      final a = (i / 24) * math.pi * 2;
      final wx = r.x + math.cos(a) * r.r;
      final wy = r.y + math.sin(a) * r.r;
      if (depthOf(wx, wy) < 24) {
        penDown = false;
        continue;
      }
      final p = project(wx, wy);
      if (penDown) {
        canvas.drawLine(prev, p, paint);
      }
      prev = p;
      penDown = true;
    }
  }
}

/// Depth-sorted draw entry.
class _Item {
  _Item(this.depth,
      {this.building, this.cover, this.prop, this.bot, this.isPlayer = false,
      this.bullet, this.flash, this.ring});
  final double depth;
  final _Building? building;
  final int? cover;
  final _Prop? prop;
  final Fighter? bot;
  final bool isPlayer;
  final Bullet? bullet;
  final Flash? flash;
  final GroundRing? ring;
}

/// Camera-space polygon vertex (right offset, forward offset, height).
class _V {
  const _V(this.rgt, this.fwd, this.h);
  final double rgt;
  final double fwd;
  final double h;
}
