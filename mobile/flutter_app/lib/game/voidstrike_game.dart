/// VOIDSTRIKE — offline Onslaught game (Flame).
///
/// Fixed 60Hz accumulator step on top of the engine's update cycle; the sim
/// mirrors Protocol v1 for the player-side state (bots run the same FSM
/// thresholds as the server). The presentation is a 2.5D side view: a
/// follow-camera pans across the projected arena so soldiers read at phone
/// scale. Online Versus connects to the Go server.
library;

import 'dart:math' as math;
import 'dart:ui' as ui;
import 'dart:ui' show Canvas, Color, Offset, Paint, PaintingStyle, Rect, Size;

import 'package:flame/camera.dart';
import 'package:flame/game.dart';

import 'protocol.dart';
import 'soldier.dart';

/// Follow-camera viewport in world units (cinematic widescreen).
const double kViewW = 1000;
const double kViewH = 430;

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
  int side = 1;
  bool backPedal = false;
  double gait = 0, stride = 0, lastX = 0, lastY = 0;
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

class VoidstrikeGame extends FlameGame {
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
  int wavePending = VsBot.countFor(1), spawnIdx = 0, nextId = 0;
  bool matchOver = false;

  // input state (wired from widgets)
  double moveX = 0, moveY = 0, aimX = 1, aimY = 0;
  bool firing = false;
  bool dashQueued = false, novaQueued = false;

  // follow camera (projected space)
  double camX = 0, camY = -80;

  // aim assist: re-engages after this many seconds without manual aim input
  double _manualAimTimer = 0;
  static const double _manualAimHold = 2.5;

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

  @override
  Future<void> onLoad() async {
    // Follow camera: a 1000×430 window scrolls with the striker, so the
    // side-view rigs render at phone-readable size in any orientation.
    camera.viewport = FixedResolutionViewport(
      resolution: Vector2(kViewW, kViewH),
    );
    camera.viewfinder.anchor = Anchor.topLeft;
    player = Fighter(0, 800, 300, VsPlayer.radius)
      ..maxHp = VsPlayer.maxHp
      ..hp = VsPlayer.maxHp
      ..speed = VsPlayer.speed
      ..energy = VsPlayer.energyMax;
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
    _updateCamera(dt);
  }

  double _acc = 0;

  void _updateCamera(double dt) {
    final floorBottom = groundY(VsWorld.height) + 26;
    final tx = (player.x - kViewW / 2).clamp(0.0, VsWorld.width - kViewW);
    final ty = (groundY(player.y) - kViewH * 0.62)
        .clamp(-110.0, math.max(-110.0, floorBottom - kViewH));
    final k = 1 - math.exp(-6 * dt);
    camX += (tx - camX) * k;
    camY += (ty - camY) * k;
  }

  /// Manual aim markers (stick deflection / mouse hover) suspend aim assist.
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

  /// Screen-space point → world-space point (letterbox + camera aware).
  Offset screenToWorld(Offset local, Size screen) {
    final scale = math.min(screen.width / kViewW, screen.height / kViewH);
    final ox = (screen.width - kViewW * scale) / 2;
    final oy = (screen.height - kViewH * scale) / 2;
    return Offset(
      (local.dx - ox) / scale + camX,
      (local.dy - oy) / scale + camY,
    );
  }

  /// Render-layer animation: side selection, walk cycle, flashes.
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

    // Body side follows the aim with hysteresis; backpedal when walking
    // away from the facing side so the cycle reads backwards.
    if (aimX2.abs() > 0.14) f.side = aimX2 >= 0 ? 1 : -1;
    f.backPedal =
        moveAmt > 0.08 && dx / math.max(dist, 1e-4) * f.side < 0;
  }

  Fighter? _nearestVisibleBot() {
    Fighter? best;
    var bestD = double.infinity;
    for (final b in bots) {
      if (!b.alive) continue;
      final dx = b.x - player.x, dy = b.y - player.y;
      final d = math.sqrt(dx * dx + dy * dy);
      if (d < bestD && _los(player.x, player.y, b.x, b.y)) {
        bestD = d;
        best = b;
      }
    }
    return best;
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

    // player movement + dash + firing
    if (player.alive) {
      player.energy = math.min(VsPlayer.energyMax,
          player.energy + VsPlayer.energyRegen * dt);

      // Aim assist: snap onto the nearest bot in line of sight whenever the
      // player has not touched the aim input recently.
      if (_manualAimTimer <= 0) {
        final target = _nearestVisibleBot();
        if (target != null) {
          final dx = target.x - player.x, dy = target.y - player.y;
          final d = math.sqrt(dx * dx + dy * dy);
          if (d > 1) {
            aimX = dx / d;
            aimY = dy / d;
          }
        }
      }

      _applyMovement(player, moveX, moveY, 1.0, dt);
      if (firing && player.fireCd <= 0 && player.energy >= VsRifle.energyCost) {
        _fireProjectile(player, aimX, aimY, true, 0);
        player.fireCd = VsRifle.fireInterval;
        player.energy -= VsRifle.energyCost;
      }
      if (dashQueued) {
        dashQueued = false;
        if (player.dashCd <= 0) {
          final l = math.sqrt(moveX * moveX + moveY * moveY);
          final dx = l > 0 ? moveX / l : aimX;
          final dy = l > 0 ? moveY / l : aimY;
          player.vx += dx * VsPlayer.dashImpulse;
          player.vy += dy * VsPlayer.dashImpulse;
          player.dashCd = VsPlayer.dashCooldown;
        }
      }
      if (novaQueued) {
        novaQueued = false;
        if (player.energy >= VsNova.energyCost) {
          player.energy -= VsNova.energyCost;
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

  // ---- rendering (2.5D side view) -------------------------------------------
  @override
  void render(Canvas canvas) {
    super.render(canvas);
    canvas.save();
    canvas.translate(-camX, -camY);

    _renderBackdrop(canvas);
    _renderWorld(canvas);

    canvas.restore();
  }

  void _renderBackdrop(Canvas canvas) {
    const floorBottom = VsWorld.height * kTilt;
    // Sky above the horizon.
    canvas.drawRect(
      Rect.fromLTWH(-80, -400, VsWorld.width + 160, 400),
      Paint()..color = const Color(VsColors.void_),
    );
    canvas.drawRect(
      Rect.fromLTWH(-80, -170, VsWorld.width + 160, 170),
      Paint()
        ..shader = ui.Gradient.linear(
          const Offset(0, -170),
          const Offset(0, 0),
          [const Color(0x00C8F31D), const Color(0x0FC8F31D)],
        ),
    );
    // Floor deck.
    canvas.drawRect(
      Rect.fromLTWH(0, 0, VsWorld.width, floorBottom),
      Paint()..color = const Color(0xFF0B0D10),
    );
    // Grid — verticals + depth-squashed horizontals.
    final grid = Paint()
      ..color = const Color(0x0DFFFFFF)
      ..strokeWidth = 1;
    final path = ui.Path();
    for (var x = 24.0; x < VsWorld.width; x += 24) {
      path.moveTo(x, 0);
      path.lineTo(x, floorBottom);
    }
    for (var y = 24.0; y < VsWorld.height; y += 24) {
      final gy = groundY(y);
      path.moveTo(0, gy);
      path.lineTo(VsWorld.width, gy);
    }
    canvas.drawPath(path, grid);
    // Horizon strip + border.
    canvas.drawLine(
      const Offset(0, 0),
      Offset(VsWorld.width, 0),
      Paint()
        ..color = const Color(0x29C8F31D)
        ..strokeWidth = 1.5,
    );
    canvas.drawRect(
      Rect.fromLTWH(0, 0, VsWorld.width, floorBottom),
      Paint()
        ..color = const Color(0x24FFFFFF)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5,
    );
  }

  void _renderWorld(Canvas canvas) {
    // Depth-sorted drawables: cover boxes + operatives by floor y.
    final order = <_Drawable>[];
    for (final ob in obstacles) {
      order.add(_Drawable(ob[1] + ob[3], box: ob));
    }
    for (final b in bots) {
      if (b.alive) order.add(_Drawable(b.y, bot: b));
    }
    if (player.alive) order.add(_Drawable(player.y, isPlayer: true));
    order.sort((a, b) => a.sortY.compareTo(b.sortY));

    final chestAll = soldierChestLift(player.radius) * 0.92;

    for (final d in order) {
      if (d.box != null) {
        _renderBox(canvas, d.box!);
      } else if (d.bot != null) {
        _renderFighter(canvas, d.bot!, isPlayer: false);
      } else {
        _renderFighter(canvas, player, isPlayer: true);
      }
    }

    // Bullets: tracers flying at chest height.
    for (final team in [true, false]) {
      final paint = Paint()
        ..color = Color(team ? VsColors.volt : VsColors.flare)
        ..strokeWidth = 3
        ..strokeCap = ui.StrokeCap.round;
      final path = ui.Path();
      for (final p in bullets) {
        if (p.fromPlayer != team) continue;
        path.moveTo(p.x - p.vx * 0.03, groundY(p.y - p.vy * 0.03) - chestAll);
        path.lineTo(p.x, groundY(p.y) - chestAll);
      }
      canvas.drawPath(path, paint);
    }

    // Muzzle flashes anchored to the visual barrels.
    final ext = muzzleExtension(player.radius);
    for (final fl in flashes) {
      final dyv = fl.dy * kTilt;
      final dl = math.sqrt(fl.dx * fl.dx + dyv * dyv);
      if (dl < 1e-6) continue;
      paintMuzzleFlash(
        canvas,
        x: fl.x + fl.dx / dl * ext,
        y: groundY(fl.y) - chestAll + dyv / dl * ext,
        dirX: fl.dx,
        dirY: dyv,
        fromPlayer: fl.fromPlayer,
        intensity: fl.life / 0.07,
      );
    }
  }

  void _renderBox(Canvas canvas, List<double> ob) {
    final bx = ob[0], by = ob[1], bw = ob[2], bh = ob[3];
    final h = bh * 1.32;
    final yFar = groundY(by);
    final yNear = groundY(by + bh);
    // Front face.
    canvas.drawRect(
      Rect.fromLTWH(bx, yNear - h, bw, h),
      Paint()
        ..shader = ui.Gradient.linear(
          Offset(0, yNear - h),
          Offset(0, yNear),
          [const Color(0xFF151920), const Color(0xFF0A0C10)],
        ),
    );
    // Top face.
    canvas.drawRect(
      Rect.fromLTWH(bx, yFar - h, bw, yNear - yFar),
      Paint()..color = const Color(0xFF1B2028),
    );
    // Silhouette + deck edge.
    canvas.drawRect(
      Rect.fromLTWH(bx, yFar - h, bw, yNear - yFar + h),
      Paint()
        ..color = const Color(0x24FFFFFF)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.4,
    );
    canvas.drawLine(
      Offset(bx, yNear - h),
      Offset(bx + bw, yNear - h),
      Paint()
        ..color = const Color(0x38FFFFFF)
        ..strokeWidth = 1.4,
    );
    // Volt corner ticks on the deck.
    final tick = Paint()
      ..color = const Color(0x80C8F31D)
      ..strokeWidth = 1.6;
    final t = 9.0;
    canvas.drawLine(Offset(bx, yFar - h + t), Offset(bx, yFar - h), tick);
    canvas.drawLine(Offset(bx, yFar - h), Offset(bx + t, yFar - h), tick);
    canvas.drawLine(Offset(bx + bw - t, yFar - h), Offset(bx + bw, yFar - h), tick);
    canvas.drawLine(Offset(bx + bw, yFar - h), Offset(bx + bw, yFar - h + t), tick);
  }

  void _renderFighter(Canvas canvas, Fighter f, {required bool isPlayer}) {
    final s = f.radius * kVisualScale;
    final gaitPhase = (f.gait / (s * 2.9)) * math.pi * 2;

    if (isPlayer) {
      // Dash-ready ring on the deck under the boots.
      final ready = f.dashCd <= 0;
      canvas.drawOval(
        Rect.fromCenter(
          center: Offset(f.x, groundY(f.y) + s * 0.06),
          width: s * 1.56,
          height: s * 0.6,
        ),
        Paint()
          ..color = Color(VsColors.volt).withValues(alpha: ready ? 0.4 : 0.12)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5,
      );
    }

    paintSoldier(
      canvas,
      x: f.x,
      y: f.y,
      radius: f.radius,
      side: f.side,
      aimX: isPlayer ? aimX : _botAimX(f),
      aimY: isPlayer ? aimY : _botAimY(f),
      gaitPhase: gaitPhase,
      stride: f.stride,
      backPedal: f.backPedal,
      palette: isPlayer ? SoldierPalette.player : SoldierPalette.bot,
      dashReady: isPlayer && f.dashCd <= 0,
    );

    // HP bar floats above the helmet.
    if (!isPlayer && f.hp < f.maxHp) {
      const w = 30.0;
      final frac = (f.hp / f.maxHp).clamp(0.0, 1.0);
      final barY = groundY(f.y) - s * 2.06;
      canvas.drawRect(
        Rect.fromLTWH(f.x - w / 2, barY, w, 3),
        Paint()..color = const Color(0x1AFFFFFF),
      );
      canvas.drawRect(
        Rect.fromLTWH(f.x - w / 2, barY, w * frac, 3),
        Paint()..color = const Color(0xFFFF3D5A),
      );
    }
  }

  double _botAimX(Fighter b) {
    if (b.state == BotAiState.attack || b.state == BotAiState.chase) {
      return player.x - b.x;
    }
    return b.vx;
  }

  double _botAimY(Fighter b) {
    if (b.state == BotAiState.attack || b.state == BotAiState.chase) {
      return player.y - b.y;
    }
    return b.vy;
  }
}

/// Depth-sort entry: boxes and fighters interleave by their floor y.
class _Drawable {
  _Drawable(this.sortY, {this.box, this.bot, this.isPlayer = false});
  final double sortY;
  final List<double>? box;
  final Fighter? bot;
  final bool isPlayer;
}
