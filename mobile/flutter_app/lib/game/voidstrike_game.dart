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
  }

  double _acc = 0;

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
    bullets.add(Bullet(
      from.x + rx * (from.radius + 6),
      from.y + ry * (from.radius + 6),
      rx * (fromPlayer ? VsRifle.projectileSpeed : VsBot.projectileSpeed),
      ry * (fromPlayer ? VsRifle.projectileSpeed : VsBot.projectileSpeed),
      fromPlayer,
    ));
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
    final botPaint = Paint()..color = const Color(VsColors.flare);
    for (final b in bots.where((b) => b.alive)) {
      canvas.drawCircle(Offset(b.x, b.y), b.radius, botPaint);
    }
    final pPaint = Paint()..color = const Color(VsColors.volt);
    if (player.alive) canvas.drawCircle(Offset(player.x, player.y), player.radius, pPaint);
    final bPaint = Paint()..color = const Color(VsColors.amber);
    for (final p in bullets) {
      canvas.drawCircle(Offset(p.x, p.y), p.radius, bPaint);
    }
  }
}
