/// VOIDSTRIKE — procedural soldier characters (Flame / Canvas port of the
/// web client rig). Top-down operatives: boots, armor torso, shoulder plates,
/// helmet + visor, and a two-handed rifle with an additive muzzle flash.
///
/// Pure drawing code — all animation state (facing, gait, shot snap) is owned
/// by the game loop and passed in as parameters.
library;

import 'dart:math' as math;
import 'dart:ui' as ui;

/// Soldiers are drawn well above their sim collision radius so the rig
/// (rifle, shoulder plates, boots) reads at arena scale.
const double kVisualScale = 2.6;

/// Where the visual barrel tip sits, in world units from the fighter origin.
double visualMuzzle(double radius) => radius * kVisualScale * 1.12;

/// Distance from the sim projectile spawn point (radius + 6) to the visual
/// barrel tip — used to anchor muzzle flashes onto the gun.
double muzzleExtension(double radius) =>
    math.max(0.0, visualMuzzle(radius) - (radius + 6));

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

/// Draw one operative. [faceAngle] is the smoothed body/facing angle,
/// [moveAngle] the travel heading, [gaitPhase] the leg cycle phase,
/// [stride] a 0..1 blend of stride amplitude.
void paintSoldier(
  ui.Canvas canvas, {
  required double x,
  required double y,
  required double radius,
  required double faceAngle,
  required double moveAngle,
  required double gaitPhase,
  required double stride,
  required SoldierPalette palette,
}) {
  final S = radius * kVisualScale;
  final c = math.cos(faceAngle);
  final s = math.sin(faceAngle);
  final gunFill = ui.Paint()..color = palette.gun;
  final gunDarkFill = ui.Paint()..color = palette.gunDark;
  final armorFill = ui.Paint()..color = palette.armor;
  final armorDarkFill = ui.Paint()..color = palette.armorDark;
  final armorLightFill = ui.Paint()..color = palette.armorLight;
  final gearFill = ui.Paint()..color = palette.gear;
  final armorOutline = ui.Paint()
    ..color = palette.armorDark
    ..style = ui.PaintingStyle.stroke
    ..strokeWidth = 1.8;

  // Team glow + shadow.
  canvas.drawCircle(
    ui.Offset(x, y),
    S * 1.42,
    ui.Paint()..color = palette.armor.withValues(alpha: 0.10),
  );
  canvas.save();
  canvas.translate(x + 2, y + 3);
  canvas.rotate(faceAngle);
  canvas.drawOval(
    ui.Rect.fromCenter(
        center: ui.Offset.zero, width: S * 1.84, height: S * 1.1),
    ui.Paint()..color = const ui.Color(0x66000000),
  );
  canvas.restore();

  // Boots — walk cycle along the movement heading.
  final mc = math.cos(moveAngle);
  final ms = math.sin(moveAngle);
  final legGap = S * 0.3;
  final legLen = S * 0.4;
  for (var i = 0; i < 2; i++) {
    final wob = (i == 0 ? math.sin(gaitPhase) : -math.sin(gaitPhase)) *
        S *
        0.26 *
        stride;
    final bx = x + mc * wob - ms * (i == 0 ? legGap : -legGap);
    final by = y + ms * wob + mc * (i == 0 ? -legGap : legGap);
    _capsule(
      canvas,
      bx - mc * legLen * 0.3,
      by - ms * legLen * 0.3,
      bx + mc * legLen * 0.36,
      by + ms * legLen * 0.36,
      S * 0.24,
      palette.gear,
    );
  }

  // Rifle — under the arms, over the boots.
  canvas.save();
  canvas.translate(x, y);
  canvas.rotate(faceAngle);
  _rrect(canvas, -S * 0.24, -S * 0.085, S * 0.42, S * 0.17, S * 0.055,
      gunDarkFill); // stock
  _rrect(canvas, S * 0.16, -S * 0.105, S * 0.56, S * 0.21, S * 0.055,
      gunFill); // receiver
  _rrect(canvas, S * 0.24, -S * 0.045, S * 0.3, S * 0.09, S * 0.03,
      armorFill); // energy cell
  _rrect(canvas, S * 0.7, -S * 0.055, S * 0.44, S * 0.11, S * 0.03,
      gunDarkFill); // barrel
  canvas.save();
  canvas.translate(S * 0.4, S * 0.11);
  canvas.rotate(0.34);
  _rrect(canvas, 0, 0, S * 0.12, S * 0.28, S * 0.04, gunDarkFill); // magazine
  canvas.restore();
  _rrect(canvas, S * 0.94, -S * 0.14, S * 0.1, S * 0.1, S * 0.02,
      gunDarkFill); // sight
  canvas.restore();

  // Torso.
  canvas.save();
  canvas.translate(x, y);
  canvas.rotate(faceAngle);
  _rrect(canvas, -S * 0.66, -S * 0.36, S * 0.28, S * 0.72, S * 0.09,
      gearFill); // backpack
  _rrect(canvas, -S * 0.48, -S * 0.54, S * 1.08, S * 1.08, S * 0.32, armorFill);
  _rrect(
      canvas, -S * 0.48, -S * 0.54, S * 1.08, S * 1.08, S * 0.32, armorOutline);
  _rrect(canvas, S * 0.06, -S * 0.32, S * 0.46, S * 0.64, S * 0.11,
      armorLightFill); // chest plate
  _rrect(canvas, -S * 0.2, -S * 0.76, S * 0.48, S * 0.27, S * 0.11,
      armorDarkFill); // pads
  _rrect(canvas, -S * 0.2, S * 0.49, S * 0.48, S * 0.27, S * 0.11,
      armorDarkFill);
  canvas.restore();

  // Arms — two-handed grip on the rifle.
  final fxx = (double l, double p) => x + c * l - s * p;
  final fyy = (double l, double p) => y + s * l + c * p;
  _capsule(
    canvas,
    fxx(S * 0.04, -S * 0.6),
    fyy(S * 0.04, -S * 0.6),
    fxx(S * 0.84, -S * 0.14),
    fyy(S * 0.84, -S * 0.14),
    S * 0.2,
    palette.armorDark,
  );
  _capsule(
    canvas,
    fxx(S * 0.04, S * 0.6),
    fyy(S * 0.04, S * 0.6),
    fxx(S * 0.44, S * 0.13),
    fyy(S * 0.44, S * 0.13),
    S * 0.2,
    palette.armor,
  );
  canvas.drawCircle(ui.Offset(fxx(S * 0.84, -S * 0.14), fyy(S * 0.84, -S * 0.14)),
      S * 0.12, gearFill);
  canvas.drawCircle(ui.Offset(fxx(S * 0.44, S * 0.13), fyy(S * 0.44, S * 0.13)),
      S * 0.12, gearFill);

  // Helmet + rim light.
  final hx = fxx(S * 0.12, 0);
  final hy = fyy(S * 0.12, 0);
  canvas.drawCircle(ui.Offset(hx, hy), S * 0.36, ui.Paint()..color = palette.helmet);
  canvas.drawArc(
    ui.Rect.fromCenter(
      center: ui.Offset(hx, hy),
      width: S * 0.72,
      height: S * 0.72,
    ),
    faceAngle + math.pi * 0.62,
    math.pi * 0.76,
    false,
    ui.Paint()
      ..color = palette.armorLight
      ..style = ui.PaintingStyle.stroke
      ..strokeWidth = 1.4,
  );

  // Visor bar.
  canvas.save();
  canvas.translate(fxx(S * 0.17, 0), fyy(S * 0.17, 0));
  canvas.rotate(faceAngle);
  _rrect(canvas, 0, -S * 0.16, S * 0.17, S * 0.32, S * 0.06,
      ui.Paint()..color = palette.visor);
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

/// Shortest-arc angular approach toward (tx, ty). Mutates and returns [cur].
double steerAngle(double cur, double tx, double ty, double dt, double k) {
  final tl = math.sqrt(tx * tx + ty * ty);
  if (tl < 1e-5) return cur;
  var target = math.atan2(ty / tl, tx / tl);
  var d = target - cur;
  while (d > math.pi) {
    d -= math.pi * 2;
  }
  while (d < -math.pi) {
    d += math.pi * 2;
  }
  return cur + d * (1 - math.exp(-k * dt));
}
