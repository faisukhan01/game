/// VOIDSTRIKE — procedural side-view soldiers (Flame / Canvas port of the
/// web 2.5D rig). The sim is top-down; this painter projects the floor with
/// a fixed camera pitch and draws every operative as an upright soldier:
/// articulated legs with a walk cycle, armored torso, backpack, helmeted
/// head with visor, and a two-handed rifle that tracks the aim vector.
///
/// Pure drawing code — all animation state (gait, stride, facing side,
/// backpedal) is owned by the game loop and passed in as parameters.
library;

import 'dart:math' as math;
import 'dart:ui' as ui;

/// Camera pitch — floor y is squashed by this factor on screen.
const double kTilt = 0.58;

/// Soldiers are drawn well above their sim collision radius so the rig
/// (rifle, torso, legs) reads at arena scale.
const double kVisualScale = 2.6;

/// Floor-space y → projected screen-space y.
double groundY(double worldY) => worldY * kTilt;

// Rig proportions (fractions of S = radius * kVisualScale).
const double _legL = 0.92;
const double _torsoH = 0.88;
const double _torsoW = 0.74;
const double _headR = 0.30;
/// Height of the rifle shoulder line above the ground anchor (× S).
const double _shoulderLift = _legL + _torsoH - 0.2;
/// Chest line used to float tracers above the floor (× S).
const double _chestLift = _legL + _torsoH * 0.55;

/// Visual muzzle pitch clamp (radians from horizontal).
const double _maxPitch = 1.05;

/// Chest line height above the floor anchor, in world units.
double soldierChestLift(double radius) => radius * kVisualScale * _chestLift;

/// Distance from the sim projectile spawn point (radius + 6) to the visual
/// barrel tip — used to anchor muzzle flashes onto the gun.
double muzzleExtension(double radius) =>
    math.max(0.0, radius * kVisualScale * 1.06 - (radius + 6));

double _clampPitch(double aimX, double aimY) {
  final p = math.atan2(-aimY * kTilt, aimX.abs() + 1e-5);
  return p.clamp(-_maxPitch, _maxPitch);
}

/// Gun-muzzle tip in projected space (used to anchor muzzle flashes).
ui.Offset muzzleTip({
  required double x,
  required double y,
  required double radius,
  required double aimX,
  required double aimY,
}) {
  final s = radius * kVisualScale;
  final dir = aimX >= 0 ? 1 : -1;
  final pitch = _clampPitch(aimX, aimY);
  final gl = s * 0.98;
  return ui.Offset(
    x + dir * math.cos(pitch) * gl,
    groundY(y) - s * _shoulderLift - math.sin(pitch) * gl,
  );
}

class SoldierPalette {
  const SoldierPalette({
    required this.armor,
    required this.armorDark,
    required this.armorLight,
    required this.helmet,
    required this.visor,
    required this.gear,
    required this.gun,
    required this.gunDark,
  });

  final ui.Color armor;
  final ui.Color armorDark;
  final ui.Color armorLight;
  final ui.Color helmet;
  final ui.Color visor;
  final ui.Color gear;
  final ui.Color gun;
  final ui.Color gunDark;

  static const SoldierPalette player = SoldierPalette(
    armor: ui.Color(0xFFC8F31D),
    armorDark: ui.Color(0xFF7E9E14),
    armorLight: ui.Color(0xFFE9FF86),
    helmet: ui.Color(0xFF181B12),
    visor: ui.Color(0xFFF2FFCF),
    gear: ui.Color(0xFF343922),
    gun: ui.Color(0xFF3A4048),
    gunDark: ui.Color(0xFF20242A),
  );

  static const SoldierPalette bot = SoldierPalette(
    armor: ui.Color(0xFFFF3D5A),
    armorDark: ui.Color(0xFF9E2440),
    armorLight: ui.Color(0xFFFF8DA1),
    helmet: ui.Color(0xFF1B1013),
    visor: ui.Color(0xFFFFC2CD),
    gear: ui.Color(0xFF3A1A22),
    gun: ui.Color(0xFF3A4048),
    gunDark: ui.Color(0xFF20242A),
  );
}

void _rrect(
  ui.Canvas canvas,
  double x,
  double y,
  double w,
  double h,
  double r,
  ui.Paint paint,
) {
  final rr = math.min(r, math.min(w, h) / 2);
  canvas.drawRRect(
    ui.RRect.fromRectAndRadius(
      ui.Rect.fromLTWH(x, y, w, h),
      ui.Radius.circular(rr),
    ),
    paint,
  );
}

void _capsule(
  ui.Canvas canvas,
  double x1,
  double y1,
  double x2,
  double y2,
  double w,
  ui.Color color,
) {
  canvas.drawLine(
    ui.Offset(x1, y1),
    ui.Offset(x2, y2),
    ui.Paint()
      ..color = color
      ..strokeWidth = w
      ..strokeCap = ui.StrokeCap.round,
  );
}

/// Draw one upright side-view operative. [x]/[y] are the sim floor position;
/// the painter projects y itself. [side] is +1 (faces right) or -1 (faces
/// left); [gaitPhase] the leg cycle phase; [stride] a 0..1 amplitude blend;
/// [backPedal] inverts the cycle when walking away from the facing side.
void paintSoldier(
  ui.Canvas canvas, {
  required double x,
  required double y,
  required double radius,
  required int side,
  required double aimX,
  required double aimY,
  required double gaitPhase,
  required double stride,
  required bool backPedal,
  required SoldierPalette palette,
  bool dashReady = false,
}) {
  final s = radius * kVisualScale;
  final ax = x;
  final ay = groundY(y);

  // Team glow + contact shadow (symmetric, under everything).
  canvas.drawOval(
    ui.Rect.fromCenter(
      center: ui.Offset(ax, ay - s * 0.1),
      width: s * 2.3,
      height: s * 1.0,
    ),
    ui.Paint()
      ..color = palette.armor
          .withValues(alpha: dashReady ? 0.10 : 0.07),
  );
  canvas.drawOval(
    ui.Rect.fromCenter(
      center: ui.Offset(ax, ay + s * 0.04),
      width: s * 1.24,
      height: s * 0.4,
    ),
    ui.Paint()..color = const ui.Color(0x73000000),
  );

  final phase = backPedal ? -gaitPhase : gaitPhase;
  final swing = s * 0.42 * stride;
  final bob = math.sin(phase).abs() * s * 0.05 * stride;
  final hipY = -s * _legL + bob;
  final torsoTop = hipY - s * _torsoH;
  final headCy = torsoTop - s * _headR * 0.95;
  final shoulderX = s * 0.1;
  final shoulderY = torsoTop + s * 0.24;

  final pitch = _clampPitch(aimX, aimY);
  final ga = -pitch; // local frame: +y is down
  final gc = math.cos(ga);
  final gs = math.sin(ga);
  final gripX = shoulderX + gc * s * 0.16;
  final gripY = shoulderY + gs * s * 0.16 + s * 0.05;
  final foreX = shoulderX + gc * s * 0.42;
  final foreY = shoulderY + gs * s * 0.42;

  canvas.save();
  canvas.translate(ax, ay);
  canvas.scale(side.toDouble(), 1.0);

  // ---- far leg (shaded) ----------------------------------------------------
  void drawLeg(int i, bool far) {
    final p = phase + (i == 0 ? 0.0 : math.pi);
    final footX = math.sin(p) * swing;
    final footY = -math.max(0.0, math.cos(p)) * s * 0.18;
    final hipX = i == 0 ? -s * 0.06 : s * 0.06;
    final kneeX = (hipX + footX) / 2 + s * 0.12;
    final kneeY = (hipY + footY) / 2;
    _capsule(canvas, hipX, hipY, kneeX, kneeY, s * 0.2,
        far ? palette.armorDark : palette.gear);
    _capsule(canvas, kneeX, kneeY, footX, footY, s * 0.15,
        far ? palette.armorDark : palette.gear);
    _rrect(
      canvas,
      footX - s * 0.1,
      footY - s * 0.07,
      s * 0.3,
      s * 0.14,
      s * 0.06,
      ui.Paint()..color = far ? palette.gunDark : palette.gear,
    );
  }

  drawLeg(0, true);

  // ---- rear arm (behind torso) ---------------------------------------------
  _capsule(canvas, -s * 0.08, shoulderY + s * 0.06, foreX, foreY, s * 0.17,
      palette.armorDark);

  // ---- torso ---------------------------------------------------------------
  _rrect(canvas, -s * 0.52, torsoTop + s * 0.1, s * 0.26, s * 0.56, s * 0.08,
      ui.Paint()..color = palette.gear); // backpack
  _rrect(canvas, -s * _torsoW / 2, torsoTop, s * _torsoW, s * _torsoH, s * 0.2,
      ui.Paint()..color = palette.armor);
  _rrect(canvas, -s * _torsoW / 2, torsoTop, s * _torsoW, s * _torsoH, s * 0.2,
      ui.Paint()
        ..color = palette.armorDark
        ..style = ui.PaintingStyle.stroke
        ..strokeWidth = 1.6);
  _rrect(canvas, s * 0.02, torsoTop + s * 0.13, s * 0.32, s * 0.5, s * 0.1,
      ui.Paint()..color = palette.armorLight); // chest plate
  _rrect(canvas, -s * _torsoW / 2, torsoTop + s * _torsoH - s * 0.14,
      s * _torsoW, s * 0.14, s * 0.05, ui.Paint()..color = palette.gear); // belt

  // ---- near leg ------------------------------------------------------------
  drawLeg(1, false);

  // ---- head ----------------------------------------------------------------
  canvas.drawRect(
    ui.Rect.fromLTWH(-s * 0.07, torsoTop - s * 0.1, s * 0.14, s * 0.14),
    ui.Paint()..color = palette.gear,
  ); // neck
  canvas.drawCircle(
    ui.Offset(s * 0.03, headCy),
    s * _headR,
    ui.Paint()..color = palette.helmet,
  );
  canvas.drawArc(
    ui.Rect.fromCenter(
      center: ui.Offset(s * 0.03, headCy),
      width: s * _headR * 1.72,
      height: s * _headR * 1.72,
    ),
    -2.5,
    1.6,
    false,
    ui.Paint()
      ..color = palette.armorLight
      ..style = ui.PaintingStyle.stroke
      ..strokeWidth = 1.4,
  ); // rim light
  _rrect(canvas, s * 0.14, headCy - s * 0.1, s * 0.17, s * 0.2, s * 0.05,
      ui.Paint()..color = palette.visor); // visor

  // ---- rifle (held in front, tracks the aim) --------------------------------
  canvas.save();
  canvas.translate(shoulderX, shoulderY);
  canvas.rotate(ga);
  final gunFill = ui.Paint()..color = palette.gun;
  final gunDarkFill = ui.Paint()..color = palette.gunDark;
  _rrect(canvas, -s * 0.34, -s * 0.05, s * 0.36, s * 0.12, s * 0.04,
      gunDarkFill); // stock
  _rrect(canvas, 0, -s * 0.06, s * 0.5, s * 0.14, s * 0.04, gunFill); // receiver
  _rrect(canvas, s * 0.06, -s * 0.025, s * 0.26, s * 0.06, s * 0.025,
      ui.Paint()..color = palette.armor); // energy cell
  _rrect(canvas, s * 0.5, -s * 0.035, s * 0.44, s * 0.08, s * 0.03,
      gunDarkFill); // barrel
  canvas.save();
  canvas.translate(s * 0.2, s * 0.07);
  canvas.rotate(0.3);
  _rrect(canvas, 0, 0, s * 0.1, s * 0.24, s * 0.035, gunDarkFill); // magazine
  canvas.restore();
  _rrect(canvas, s * 0.56, -s * 0.13, s * 0.09, s * 0.09, s * 0.02,
      gunDarkFill); // sight
  canvas.restore();

  // ---- front arm + gloves (over the rifle) -----------------------------------
  _capsule(canvas, s * 0.02, shoulderY + s * 0.1, gripX, gripY, s * 0.17,
      palette.armor);
  final gloves = ui.Paint()..color = palette.gear;
  canvas.drawCircle(ui.Offset(gripX, gripY), s * 0.1, gloves);
  canvas.drawCircle(ui.Offset(foreX, foreY), s * 0.1, gloves);

  canvas.restore();
}

/// Additive muzzle flash at the barrel tip. [intensity] runs 1 → 0.
void paintMuzzleFlash(
  ui.Canvas canvas, {
  required double x,
  required double y,
  required double dirX,
  required double dirY,
  required bool fromPlayer,
  required double intensity,
}) {
  final hot = fromPlayer ? const ui.Color(0xFFFBFFE8) : const ui.Color(0xFFFFE4E9);
  final mid = fromPlayer ? const ui.Color(0xFFE4FF70) : const ui.Color(0xFFFF8DA1);
  final len = 12 + 20 * intensity;
  final fill = ui.Paint()..blendMode = ui.BlendMode.lighten;

  canvas.save();
  canvas.translate(x, y);
  canvas.rotate(math.atan2(dirY, dirX));
  fill.color = mid.withValues(alpha: math.min(1.0, intensity * 1.2));
  final spike = ui.Path()
    ..moveTo(len, 0)
    ..lineTo(len * 0.35, -len * 0.30)
    ..lineTo(len * 0.12, 0)
    ..lineTo(len * 0.35, len * 0.30)
    ..close();
  canvas.drawPath(spike, fill);
  final cross = ui.Path()
    ..moveTo(2, -len * 0.44)
    ..lineTo(len * 0.2, -len * 0.12)
    ..lineTo(len * 0.2, len * 0.12)
    ..lineTo(2, len * 0.44)
    ..close();
  canvas.drawPath(cross, fill);
  fill.color = hot.withValues(alpha: math.min(1.0, intensity * 1.4));
  canvas.drawCircle(ui.Offset(1, 0), 3 + 2.6 * intensity, fill);
  canvas.restore();
}
