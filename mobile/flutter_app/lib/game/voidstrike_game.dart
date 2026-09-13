/// VOIDSTRIKE — offline Onslaught game (Flame).
///
/// Fixed 60Hz accumulator step on top of the engine's update cycle; the sim
/// mirrors Protocol v1 for the player-side state (bots run the same FSM
/// thresholds as the server). Online Versus connects to the Go server.
library;

import 'dart:math' as math;

import 'package:flame/components.dart';
import 'package:flame/events.dart';
import 'package:flame/game.dart';

import 'protocol.dart';
import 'soldier.dart';

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
  // cosmetic animation (render layer only)
  double faceAngle = 0;
  double gait = 0, stride = 0, lastX = 0, lastY = 0;
  double sinceShot = 9, shotDx = 1, shotDy = 0;
  bool faceSeeded = false;
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

class MatchResult {
  MatchResult(this.score, this.kills, this.wave, this.durationSec);
  final int score, kills, wave, durationSec;
}

/// Callback when the run ends (drives the results sheet).
typedef OnMatchOver = void Function(MatchResult result);

class VoidstrikeGame extends FlameGame with TapCallbacks {
  VoidstrikeGame({required this.onMatchOver, this.seed = 1337});

  final OnMatchOver onMatchOver;
  final int seed;
  late final math.Random rng = math.Random(seed);

  late Fighter player;
  final List<Fighter> bots = [];
  final List<Bullet> bullets = [];
  final List<Flash> flashes = [];

  int score = 0, kills = 0, wave = 1, combo = 1;
  double comboTimer = 0, spawnTimer = VsBot.spawnStagger, elapsed = 0;
  int wavePending = VsBot.countFor(1), spawnIdx = 0;
  bool matchOver = false;

  // input state (wired from widgets)
  double moveX = 0, moveY = 0, aimX = 1, aimY = 0;
  bool firing = false;
  bool dashQueued = false, novaQueued = false;

  static const List<List<double>> obstacles = [
    [200, 150, 220, 40],
    [1180, 150, 220, 40],
    [200, 710, 220, 40],
    [700, 420, 200, 60],
    [1180, 710, 220, 40],
  ];

  @override
  Future<void> onLoad() async {
    // Letterbox the 1600×900 world onto any screen (phone/tablet/desktop).
    camera.viewport = FixedResolutionViewport(
      resolution: Vector2(VsWorld.width, VsWorld.height),
    );
    player = Fighter(0, 800, 300, VsPlayer.radius)
      ..maxHp = VsPlayer.maxHp
      ..hp = VsPlayer.maxHp
      ..speed = VsPlayer.speed;
  }

  @override
  void update(double dt) {
    super.update(dt);
    // Fixed-step accumulator: run Protocol ticks at 60Hz.
    _acc += dt;
    var steps = 0;
    while (_acc >= VsWorld.dt && steps < 5) {
      _tick(VsWorld.dt);
      _acc -= VsWorld.dt;
      steps++;
    }
    if (steps >= 5) _acc = 0;
    _updateCosmetics(dt);
  }

  double _acc = 0;

  /// Render-layer animation: facing smoothing, walk cycle, flashes.
  void _updateCosmetics(double dt) {
    player.initAnim();
    _animate(player, dt, aimX, aimY);
    for (final b in bots) {
      if (!b.alive) continue;
      b.initAnim();
      var ax = 0.0, ay = 0.0;
      if (b.state == BotAiState.attack || b.state == BotAiState.chase) {
        ax = player.x - b.x;
        ay = player.y - b.y;
      } else if (math.sqrt(b.vx * b.vx + b.vy * b.vy) > 1) {
        ax = b.vx;
        ay = b.vy;
      }
      _animate(b, dt, ax, ay);
    }
    for (var i = flashes.length - 1; i >= 0; i--) {
      flashes[i].life -= dt;
      if (flashes[i].life <= 0) flashes.removeAt(i);
    }
  }

  void _animate(Fighter f, double dt, double aimX2, double aimY2) {
    final dx = f.x - f.lastX;
    final dy = f.y - f.lastY;
    final dist = math.sqrt(dx * dx + dy * dy);
    f.lastX = f.x;
    f.lastY = f.y;
    if (dist > 0.05) f.gait += dist;
    final speedRef = math.max(1.0, f.speed * dt);
    final moveAmt = math.min(1.0, dist / speedRef);
    f.stride += (moveAmt - f.stride) * (1 - math.exp(-14 * dt));
    f.sinceShot += dt;

    if (!f.faceSeeded) {
      if (aimX2 * aimX2 + aimY2 * aimY2 > 1e-5) {
        f.faceAngle = math.atan2(aimY2, aimX2);
        f.faceSeeded = true;
      }
      return;
    }
    // Velocity heading (weak), recent shot snap (strong), then intent aim.
    if (moveAmt > 0.08) {
      final last = math.sqrt(f.vx * f.vx + f.vy * f.vy);
      if (last > 1) {
        f.faceAngle = steerAngle(f.faceAngle, f.vx / last, f.vy / last, dt, 9);
      }
    }
    if (f.sinceShot < 0.45) {
      f.faceAngle = steerAngle(f.faceAngle, f.shotDx, f.shotDy, dt, 16);
    }
    f.faceAngle = steerAngle(f.faceAngle, aimX2, aimY2, dt, f.id == 0 ? 18 : 10);
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
    if (spawnTimer > 0) spawnTimer -= dt;

    // player movement + dash
    if (player.alive) {
      if (dashQueued && player.fireCd <= VsPlayer.dashCooldown - VsPlayer.dashCooldown) {
        // dash handled via dedicated cooldown below
      }
      _applyMovement(player, moveX, moveY, 1.0, dt);
      // firing
      if (firing && player.fireCd <= 0) {
        _fireProjectile(player, aimX, aimY, true, 0);
        player.fireCd = VsRifle.fireInterval;
      }
      // dash + nova queued by UI
      if (dashQueued) {
        dashQueued = false;
        final l = math.sqrt(moveX * moveX + moveY * moveY);
        final dx = l > 0 ? moveX / l : aimX;
        final dy = l > 0 ? moveY / l : aimY;
        player.vx += dx * VsPlayer.dashImpulse;
        player.vy += dy * VsPlayer.dashImpulse;
      }
      if (novaQueued) {
        novaQueued = false;
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

    // bots
    for (final b in bots) {
      if (!b.alive) continue;
      _updateBot(b, dt);
    }

    // resolve world
    _resolveBounds(player);
    for (final b in bots) {
      if (b.alive) _resolveBounds(b);
    }

    // projectiles
    for (final p in bullets) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.fromPlayer) {
        for (final b in bots.where((b) => b.alive)) {
          final dx = p.x - b.x, dy = p.y - b.y;
          if (dx * dx + dy * dy < (p.radius + b.radius) * (p.radius + b.radius)) {
            b.hp -= VsRifle.damage;
            p.life = 0;
            break;
          }
        }
      } else if (player.alive) {
        final dx = p.x - player.x, dy = p.y - player.y;
        if (dx * dx + dy * dy < (p.radius + player.radius) * (p.radius + player.radius)) {
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
        score += 100 * combo;
        kills++;
        combo = (combo < 5) ? combo + 1 : combo;
        comboTimer = 3.0;
      }
    }
    if (player.alive && player.hp <= 0) {
      player.alive = false;
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

  void _fireProjectile(Fighter from, double dx, double dy, bool fromPlayer, int waveN) {
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
    from.sinceShot = 0;
    from.shotDx = rx;
    from.shotDy = ry;
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
        final wd = math.sqrt((b.wpx - b.x) * (b.wpx - b.x) + (b.wpy - b.y) * (b.wpy - b.y));
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
    _applyMovement(b, mx, my, b.state == BotAiState.strafe || b.state == BotAiState.attack ? 0.6 : 1.0, dt);

    if (b.state == BotAiState.attack && b.fireCd <= 0 && dist < 420 &&
        _los(b.x, b.y, player.x, player.y) && player.alive) {
      _fireProjectile(b, pdx / dist, pdy / dist, false, b.waveN);
      b.fireCd = VsBot.fireInterval;
    }
  }

  void _applyMovement(Fighter f, double mx, double my, double mul, double dt) {
    final l = math.sqrt(mx * mx + my * my);
    double tx = 0, ty = 0;
    if (l > 0) {
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
      if (t1 > t2) { final t = t1; t1 = t2; t2 = t; }
      tmin = tmin > t1 ? tmin : t1;
      tmax = tmax < t2 ? tmax : t2;
      if (tmin > tmax) return false;
    }
    if (dy.abs() < 1e-12) {
      if (y1 < b[1] || y1 > b[1] + b[3]) return false;
    } else {
      var t1 = (b[1] - y1) / dy, t2 = (b[1] + b[3] - y1) / dy;
      if (t1 > t2) { final t = t1; t1 = t2; t2 = t; }
      tmin = tmin > t1 ? tmin : t1;
      tmax = tmax < t2 ? tmax : t2;
      if (tmin > tmax) return false;
    }
    return true;
  }

  // ---- rendering ----
  @override
  void render(Canvas canvas) {
    canvas.drawRect(
      const Rect.fromLTWH(0, 0, VsWorld.width, VsWorld.height),
      Paint()..color = const Color(VsColors.void_),
    );
    for (final ob in obstacles) {
      canvas.drawRect(
        Rect.fromLTWH(ob[0], ob[1], ob[2], ob[3]),
        Paint()..color = const Color(VsColors.panel),
      );
    }

    // Hostile operatives.
    for (final b in bots.where((b) => b.alive)) {
      b.initAnim();
      paintSoldier(
        canvas,
        x: b.x,
        y: b.y,
        radius: b.radius,
        faceAngle: b.faceAngle,
        moveAngle: (b.vx * b.vx + b.vy * b.vy > 1)
            ? math.atan2(b.vy, b.vx)
            : b.faceAngle,
        gaitPhase: (b.gait / (b.radius * kVisualScale * 2.9)) * math.pi * 2,
        stride: b.stride,
        palette: SoldierPalette.bot,
      );
      if (b.hp < b.maxHp) {
        final w = 30.0, frac = (b.hp / b.maxHp).clamp(0.0, 1.0);
        final barY = b.y - b.radius * kVisualScale - 10;
        canvas.drawRect(
          Rect.fromLTWH(b.x - w / 2, barY, w, 3),
          Paint()..color = const Color(0x1AFFFFFF),
        );
        canvas.drawRect(
          Rect.fromLTWH(b.x - w / 2, barY, w * frac, 3),
          Paint()..color = const Color(0xFFFF3D5A),
        );
      }
    }

    // Striker operative + dash-ready ring.
    if (player.alive) {
      player.initAnim();
      canvas.drawCircle(
        Offset(player.x, player.y),
        player.radius * kVisualScale + 6,
        Paint()
          ..color = const Color(0xFFC8F31D)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5
          ..alpha = player.fireCd <= 0 ? 102 : 31,
      );
      paintSoldier(
        canvas,
        x: player.x,
        y: player.y,
        radius: player.radius,
        faceAngle: player.faceAngle,
        moveAngle: (player.vx * player.vx + player.vy * player.vy > 1)
            ? math.atan2(player.vy, player.vx)
            : player.faceAngle,
        gaitPhase: (player.gait / (player.radius * kVisualScale * 2.9)) * math.pi * 2,
        stride: player.stride,
        palette: SoldierPalette.player,
      );
    }

    // Bullets.
    final bPaint = Paint()..color = const Color(VsColors.amber);
    for (final p in bullets) {
      canvas.drawCircle(Offset(p.x, p.y), p.radius, bPaint);
    }

    // Muzzle flashes on top of the barrels (extended to the visual muzzle —
    // the sim spawns projectiles closer to the body than the gun tip).
    final ext = muzzleExtension(player.radius);
    for (final fl in flashes) {
      paintMuzzleFlash(
        canvas,
        x: fl.x + fl.dx * ext,
        y: fl.y + fl.dy * ext,
        dirX: fl.dx,
        dirY: fl.dy,
        fromPlayer: fl.fromPlayer,
        intensity: fl.life / 0.07,
      );
    }
  }
}
