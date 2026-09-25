/// VOIDSTRIKE — natural arena environment ("OLD TOWN PARK" theme) — Flame /
/// dart:ui port of the web environment module.
///
/// The deterministic sim only knows five AABB cover footprints; this module
/// re-skins the presentation as an abandoned park on the edge of a derelict
/// housing society at dusk: dry grass and dirt paths, a cracked road,
/// boundary walls, an abandoned restaurant, market kiosks and a guard cabin
/// built over those same footprints (visual-only — collisions never change).
///
/// Everything static is baked once into offscreen [ui.Picture]s (dusk sky +
/// derelict skyline, ground scatter, each structure's face). Only swaying
/// trees, drifting clouds and birds are drawn per-frame. The seeded
/// mulberry32 RNG is bit-identical to the web version, so the arena layout
/// matches the web client pixel for pixel.
///
/// Coordinate spaces: the web renderer has a 238px screen-space horizon
/// (ENV_HORIZON); the Flutter follow camera projects the floor with
/// [groundY] = worldY * 0.58 and the horizon sits at projected y = 0. So the
/// baked sky picture spans projected y in [-400, 0], the ground picture is
/// blitted at y = 0, and structures / decor anchor at [groundY] with no
/// horizon offset. Baked art itself is drawn in the same local coordinates
/// as the web canvases.
library;

import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/painting.dart'
    show TextBaseline, TextPainter, TextSpan, TextStyle, FontWeight;

import 'protocol.dart' show VsWorld;
import 'soldier.dart' show groundY, kTilt;

// ------------------------------------------------------------------ helpers

/// Deterministic 32-bit RNG (mulberry32) — bit-identical to the web port.
///
/// Dart ints are 64-bit, so every intermediate is masked to 32 bits; the
/// multiply keeps the low 32 bits exactly like JS `Math.imul`, and XOR works
/// on the same bit patterns. Verified against the TS original for every seed
/// used in this module.
class _Rng {
  _Rng(int seed) : _a = seed & 0xFFFFFFFF;

  int _a;

  /// Next uniform in [0, 1).
  double next() {
    _a = (_a + 0x6D2B79F5) & 0xFFFFFFFF;
    var t = _a;
    t = _imul(t ^ (t >>> 15), t | 1);
    t = t ^ ((t + _imul(t ^ (t >>> 7), t | 61)) & 0xFFFFFFFF);
    // t < 2^32 as a 64-bit int, so the XOR result is already unsigned.
    return (t ^ (t >>> 14)) / 4294967296;
  }

  /// 32-bit multiply — the low 32 bits of the product (JS Math.imul).
  static int _imul(int a, int b) => (a * b) & 0xFFFFFFFF;
}

/// Web canvas `rgba(r, g, b, a)` fill style → dart:ui color.
ui.Color _rgba(int r, int g, int b, double a) => ui.Color.fromRGBO(r, g, b, a);

/// Floor-space y → ground-canvas local y (the baked ground starts at the
/// horizon, exactly like the web `localY()`).
double _localY(double worldY) => worldY * kTilt;

/// Maps a canvas 2D radial-gradient stop (0..1 across the inner→outer radii)
/// onto a dart:ui radial gradient position (0..1 across 0→outer radius), so
/// two-point radial gradients port exactly.
double _stop(double t, double r0, double r1) => (r0 + t * (r1 - r0)) / r1;

// ------------------------------------------------------------------- palette
// Ported from the web `C` map (same hex values). Colors never referenced by
// the web draw code (cloud, dirt, dirtLight, mortar, path, plasterDark,
// woodDark) are omitted so the analyzer stays clean.

const ui.Color _cSkyTop = ui.Color(0xFF26201D);
const ui.Color _cSkyMid = ui.Color(0xFF6E4A33);
const ui.Color _cSkyGlow = ui.Color(0xFFC9894E);
const ui.Color _cSkySun = ui.Color(0xFFFFE9BB);
const ui.Color _cSkylineFar = ui.Color(0xFF4A3B31);
const ui.Color _cSkylineNear = ui.Color(0xFF332A25);
const ui.Color _cGrassFar = ui.Color(0xFF5C5E46);
const ui.Color _cGrassMid = ui.Color(0xFF4C5039);
const ui.Color _cGrassNear = ui.Color(0xFF3B402D);
const ui.Color _cRoad = ui.Color(0xFF43444A);
const ui.Color _cRoadEdge = ui.Color(0xFF5A5B60);
const ui.Color _cRoadDash = ui.Color(0xFF9A947E);
const ui.Color _cWood = ui.Color(0xFF6B5138);
const ui.Color _cWoodLight = ui.Color(0xFF836546);
const ui.Color _cBrick = ui.Color(0xFF7A4A38);
const ui.Color _cBrickDark = ui.Color(0xFF5E382C);
const ui.Color _cBrickLight = ui.Color(0xFF8A5A44);
const ui.Color _cPlaster = ui.Color(0xFFB3A489);
const ui.Color _cPlasterLight = ui.Color(0xFFC4B69C);
const ui.Color _cTin = ui.Color(0xFF7A8288);
const ui.Color _cTinDark = ui.Color(0xFF5C6368);
const ui.Color _cRust = ui.Color(0xFF7A5C48);
const ui.Color _cLeaf = ui.Color(0xFF425632);
const ui.Color _cLeafLight = ui.Color(0xFF587441);
const ui.Color _cLeafDark = ui.Color(0xFF32421F);
const ui.Color _cDeadWood = ui.Color(0xFF4A3E33);
final ui.Color _cShadow = _rgba(10, 12, 8, 0.42);

// ------------------------------------------------------------------- layout

/// Web screen-space horizon line — the sky/ground seam. The Flutter camera
/// projects the floor with no offset, so this is only the bake-side origin.
const double kHorizon = 238.0;

/// How far above the horizon the baked sky reaches (projected y in [-400, 0]).
const double _skyExtent = 400.0;

/// Baked ground height: WORLD_H * TILT (900 * 0.58 = 522).
final double _groundH = (VsWorld.height * kTilt).ceilToDouble();

/// Visual heights (screen px) of each cover structure. Collision footprints
/// stay exactly the PROTOCOL AABBs — height is presentation only.
const List<double> kStructHeights = <double>[64, 64, 82, 118, 78];

/// A no-collision scenery prop, depth-sorted with fighters by floor y.
class Decor {
  const Decor(this.kind, this.x, this.y, this.scale, this.variant, this.dead);

  /// 'tree' | 'bush' | 'rock'.
  final String kind;
  final double x;

  /// Floor-space y.
  final double y;
  final double scale;
  final int variant;
  final bool dead;
}

/// Hand-placed props — kept clear of cover footprints and spawn points.
/// Identical to the web `DECOR` constant (19 entries).
const List<Decor> kDecor = <Decor>[
  Decor('tree', 520, 118, 1.06, 0, true),
  Decor('tree', 62, 214, 1.0, 1, false),
  Decor('tree', 1516, 168, 1.12, 2, false),
  Decor('tree', 622, 664, 0.95, 3, false),
  Decor('tree', 1022, 636, 1.02, 4, true),
  Decor('tree', 1402, 556, 1.1, 5, false),
  Decor('tree', 352, 566, 0.92, 6, false),
  Decor('tree', 758, 236, 1.0, 7, false),
  Decor('bush', 252, 322, 1.0, 0, false),
  Decor('bush', 902, 204, 0.9, 1, false),
  Decor('bush', 1448, 700, 1.0, 2, false),
  Decor('bush', 552, 798, 0.85, 3, false),
  Decor('bush', 1252, 306, 1.05, 4, false),
  Decor('bush', 82, 622, 0.95, 5, false),
  Decor('rock', 482, 424, 1.0, 0, false),
  Decor('rock', 1102, 762, 1.1, 1, false),
  Decor('rock', 62, 862, 0.9, 2, false),
  Decor('rock', 1556, 402, 0.95, 3, false),
  Decor('rock', 872, 566, 0.8, 4, false),
];

// -------------------------------------------------------------- baked caches

ui.Picture? _sky;
ui.Picture? _ground;
final List<ui.Picture?> _structures = List<ui.Picture?>.filled(5, null);

ui.Picture _skyPic() => _sky ??= _bakeSky();
ui.Picture _groundPic() => _ground ??= _bakeGround();

ui.Picture _structPic(int index, double w) {
  final cached = _structures[index];
  if (cached != null) return cached;
  final pic = _bakeStructure(index, w);
  _structures[index] = pic;
  return pic;
}

// ----------------------------------------------------------------------- sky

ui.Picture _bakeSky() {
  const w = VsWorld.width;
  const h = kHorizon;
  final recorder = ui.PictureRecorder();
  final c = recorder.beginRecording(
    const ui.Rect.fromLTWH(0, -_skyExtent, w, _skyExtent),
  );
  // Cover the whole band so nothing ever shows through the top (the camera
  // rarely scrolls this high, but keep it opaque).
  c.drawRect(
    const ui.Rect.fromLTWH(0, -_skyExtent, w, _skyExtent),
    ui.Paint()..color = _cSkyTop,
  );
  // Everything below is drawn in web sky-canvas coordinates (y 0..238, with
  // the horizon at 238) — translated onto projected y = y_web - 238.
  c.translate(0, -kHorizon);

  // Dusk gradient.
  c.drawRect(
    const ui.Rect.fromLTWH(0, 0, w, h),
    ui.Paint()
      ..shader = ui.Gradient.linear(
        const ui.Offset(0, 0),
        const ui.Offset(0, kHorizon),
        const [_cSkyTop, ui.Color(0xFF4E3A2E), _cSkyMid, _cSkyGlow],
        const [0.0, 0.45, 0.78, 1.0],
      ),
  );

  // Low sun with a soft halo.
  const sunX = 1160.0;
  const sunY = 168.0;
  c.drawRect(
    const ui.Rect.fromLTWH(sunX - 200, sunY - 200, 400, 400),
    ui.Paint()
      ..shader = ui.Gradient.radial(
        const ui.Offset(sunX, sunY),
        190,
        [
          _rgba(255, 233, 187, 0.85),
          _rgba(240, 190, 120, 0.38),
          _rgba(240, 190, 120, 0.0),
        ],
        // Inner radius 8 → outer 190, like the web two-point gradient.
        [_stop(0, 8, 190), _stop(0.25, 8, 190), 1.0],
      ),
  );
  c.drawCircle(const ui.Offset(sunX, sunY), 26, ui.Paint()..color = _cSkySun);

  final rand = _Rng(0xC0FFEE);

  // ---- far skyline: derelict society towers, half-demolished ---------------
  var x = -20.0;
  var i = 0;
  while (x < w + 20) {
    final bw = 46 + rand.next() * 90;
    final bh = 52 + rand.next() * 84;
    _skyBlock(c, x, bw, bh, _cSkylineFar, 0x5157 + i * 97);
    x += bw + 4 + rand.next() * 26;
    i++;
  }
  // Near band (darker, sparser, taller).
  x = 30;
  i = 0;
  while (x < w + 20) {
    final bw = 60 + rand.next() * 110;
    final bh = 30 + rand.next() * 58;
    _skyBlock(c, x, bw, bh, _cSkylineNear, 0x9A21 + i * 131);
    x += bw + 30 + rand.next() * 90;
    i++;
  }

  // Power poles with sagging wires across the horizon.
  const poles = <double>[90, 420, 760, 1080, 1420];
  final polePaint = ui.Paint()
    ..color = const ui.Color(0xFF241D19)
    ..strokeWidth = 3;
  for (final px in poles) {
    final ph = 34.0 + (px % 37);
    c.drawLine(ui.Offset(px, h), ui.Offset(px, h - ph), polePaint);
    c.drawLine(
      ui.Offset(px - 9, h - ph + 7),
      ui.Offset(px + 9, h - ph + 7),
      polePaint,
    );
  }
  final wirePaint = ui.Paint()
    ..color = _rgba(30, 24, 20, 0.8)
    ..strokeWidth = 1.2;
  final wirePath = ui.Path();
  for (var p = 0; p < poles.length - 1; p++) {
    final x1 = poles[p];
    final x2 = poles[p + 1];
    final y1 = h - (34.0 + (x1 % 37)) + 7;
    final y2 = h - (34.0 + (x2 % 37)) + 7;
    wirePath.moveTo(x1, y1);
    wirePath.quadraticBezierTo((x1 + x2) / 2, math.max(y1, y2) + 14, x2, y2);
  }
  c.drawPath(wirePath, wirePaint);

  // Dead scrub on the horizon line.
  final scrubPaint = ui.Paint()
    ..color = _rgba(40, 32, 24, 0.7)
    ..strokeWidth = 1.4;
  for (var sx = 0.0; sx < w; sx += 14) {
    if (rand.next() < 0.4) continue;
    final sh = 3 + rand.next() * 9;
    c.drawLine(
      ui.Offset(sx, h),
      ui.Offset(sx + (rand.next() - 0.5) * 8, h - sh),
      scrubPaint,
    );
  }
  return recorder.endRecording();
}

/// One derelict skyline block: silhouette + broken roofline, water tank on
/// some roofs, a few faint warm windows. Drawn in web sky-canvas coords.
void _skyBlock(
  ui.Canvas c,
  double bx,
  double bw,
  double bh,
  ui.Color color,
  int seed,
) {
  const h = kHorizon;
  final r = _Rng(seed);
  final top = h - bh;
  final blockPaint = ui.Paint()..color = color;
  c.drawRect(ui.Rect.fromLTWH(bx, top, bw, bh), blockPaint);
  // Broken roofline — nibble the parapet.
  final skyPaint = ui.Paint()..color = _cSkyTop;
  var nx = bx;
  while (nx < bx + bw) {
    if (r.next() < 0.55) {
      final nw = 6 + r.next() * 16;
      final nd = 4 + r.next() * 10;
      c.drawRect(ui.Rect.fromLTWH(nx, top, nw, nd), skyPaint);
      nx += nw;
    } else {
      nx += 8 + r.next() * 20;
    }
  }
  // Water tank on some roofs.
  if (r.next() < 0.5) {
    final tx = bx + 8 + r.next() * (bw - 26);
    c.drawRect(ui.Rect.fromLTWH(tx, top - 12, 14, 12), blockPaint);
    c.drawRect(ui.Rect.fromLTWH(tx - 2, top - 14, 18, 3), blockPaint);
  }
  // A few faint warm windows (most abandoned, some still lit).
  final warmPaint = ui.Paint()..color = _rgba(255, 190, 110, 0.30);
  final darkPaint = ui.Paint()..color = _rgba(0, 0, 0, 0.35);
  for (var wy = top + 10.0; wy < h - 8; wy += 14) {
    for (var wx = bx + 6.0; wx < bx + bw - 8; wx += 12) {
      final lit = r.next();
      if (lit < 0.06) {
        c.drawRect(ui.Rect.fromLTWH(wx, wy, 6, 7), warmPaint);
      } else if (lit < 0.2) {
        c.drawRect(ui.Rect.fromLTWH(wx, wy, 6, 7), darkPaint);
      }
    }
  }
}

// -------------------------------------------------------------------- ground

ui.Picture _bakeGround() {
  const w = VsWorld.width;
  final h = _groundH;
  final recorder = ui.PictureRecorder();
  final c = recorder.beginRecording(ui.Rect.fromLTWH(0, 0, w, h));
  final rand = _Rng(0x600D13);

  // Dry park grass — slightly darker toward the camera.
  c.drawRect(
    ui.Rect.fromLTWH(0, 0, w, h),
    ui.Paint()
      ..shader = ui.Gradient.linear(
        const ui.Offset(0, 0),
        ui.Offset(0, h),
        const [_cGrassFar, _cGrassMid, _cGrassNear],
        const [0.0, 0.4, 1.0],
      ),
  );

  // Large soft tonal patches (mown / dried out areas).
  for (var p = 0; p < 34; p++) {
    final px = rand.next() * w;
    final py = rand.next() * h;
    final pr = 60 + rand.next() * 150;
    final dark = rand.next() < 0.5;
    c.drawOval(
      ui.Rect.fromCenter(
        center: ui.Offset(px, py),
        width: pr * 2,
        height: pr * 1.1,
      ),
      ui.Paint()
        ..shader = ui.Gradient.radial(
          ui.Offset(px, py),
          pr,
          [
            dark ? _rgba(38, 44, 28, 0.30) : _rgba(112, 112, 72, 0.22),
            const ui.Color(0x00000000),
          ],
          [_stop(0, pr * 0.2, pr), 1.0],
        ),
    );
  }

  // Dirt worn patches.
  for (var p = 0; p < 22; p++) {
    final px = rand.next() * w;
    final py = rand.next() * h;
    final pr = 24 + rand.next() * 60;
    final rot = rand.next() * math.pi;
    c.save();
    c.translate(px, py);
    c.rotate(rot);
    c.drawOval(
      ui.Rect.fromCenter(
        center: ui.Offset.zero,
        width: pr * 2,
        height: pr,
      ),
      ui.Paint()..color = _rgba(107, 90, 66, 0.5),
    );
    c.drawOval(
      ui.Rect.fromCenter(
        center: ui.Offset(-pr * 0.15, -pr * 0.1),
        width: pr * 1.2,
        height: pr * 0.6,
      ),
      ui.Paint()..color = _rgba(125, 108, 82, 0.35),
    );
    c.restore();
  }

  // Cracked asphalt road band across the lower half.
  final roadTop = _localY(540);
  final roadBot = _localY(668);
  c.drawRect(
    ui.Rect.fromLTWH(0, roadTop, w, roadBot - roadTop),
    ui.Paint()..color = _cRoad,
  );
  // Edge wear.
  c.drawRect(ui.Rect.fromLTWH(0, roadTop, w, 4), ui.Paint()..color = _cRoadEdge);
  c.drawRect(
    ui.Rect.fromLTWH(0, roadBot - 4, w, 4),
    ui.Paint()..color = _cRoadEdge,
  );
  // Grass creeping over the edges.
  final creepPaint = ui.Paint()..color = _rgba(76, 80, 57, 0.9);
  for (var ex = 0.0; ex < w; ex += 10) {
    if (rand.next() < 0.55) {
      c.drawRect(
        ui.Rect.fromLTWH(ex, roadTop - 2 - rand.next() * 3, 5 + rand.next() * 6, 3),
        creepPaint,
      );
    }
    if (rand.next() < 0.55) {
      c.drawRect(
        ui.Rect.fromLTWH(ex, roadBot - 1 + rand.next() * 2, 5 + rand.next() * 6, 3),
        creepPaint,
      );
    }
  }
  // Faded center dashes.
  for (var dx = 20.0; dx < w; dx += 120) {
    c.drawRect(
      ui.Rect.fromLTWH(dx, (roadTop + roadBot) / 2 - 3, 52, 5),
      ui.Paint()
        ..color = _rgba(154, 148, 126, 0.35 + rand.next() * 0.3),
    );
  }
  // Potholes.
  for (var p = 0; p < 16; p++) {
    final px = rand.next() * w;
    final py = roadTop + 8 + rand.next() * (roadBot - roadTop - 16);
    c.drawOval(
      ui.Rect.fromCenter(
        center: ui.Offset(px, py),
        width: 2 * (7 + rand.next() * 16),
        height: 2 * (3 + rand.next() * 6),
      ),
      ui.Paint()..color = _rgba(24, 26, 28, 0.55),
    );
  }
  // Tar patches + cracks.
  final crackPaint = ui.Paint()
    ..color = _rgba(20, 22, 24, 0.5)
    ..strokeWidth = 1.2;
  final crackPath = ui.Path();
  for (var k = 0; k < 26; k++) {
    var cx = rand.next() * w;
    var cy = roadTop + rand.next() * (roadBot - roadTop);
    crackPath.moveTo(cx, cy);
    for (var s = 0; s < 4; s++) {
      cx += (rand.next() - 0.5) * 34;
      cy += (rand.next() - 0.5) * 12;
      crackPath.lineTo(cx, cy);
    }
  }
  c.drawPath(crackPath, crackPaint);

  // Dirt footpath: from the road up to the restaurant door, plus rim paths.
  void drawPathSeg(double x0, double y0, double x1, double y1) {
    const steps = 22;
    final paint = ui.Paint()..color = _rgba(138, 119, 88, 0.85);
    for (var s = 0; s <= steps; s++) {
      final t = s / steps;
      final px = x0 + (x1 - x0) * t + math.sin(t * 5) * 14;
      final py = y0 + (y1 - y0) * t;
      final pw = 46 * (0.75 + 0.25 * math.sin(t * 9));
      c.drawOval(
        ui.Rect.fromCenter(
          center: ui.Offset(px, py),
          width: pw,
          height: pw * kTilt * 0.9,
        ),
        paint,
      );
    }
  }

  const pathW = 46.0;
  drawPathSeg(800, roadBot + 6, 800, _localY(492)); // road → restaurant front
  drawPathSeg(120, _localY(300), 380, _localY(320)); // rim path upper-left
  drawPathSeg(1420, _localY(320), 1560, _localY(350));
  drawPathSeg(240, roadTop - 4, 500, _localY(500)); // road → upper park
  // Path pebbles.
  for (var p = 0; p < 90; p++) {
    final t = rand.next();
    final px = 800 + math.sin(t * 5) * 14 + (rand.next() - 0.5) * pathW;
    final py = _localY(492) + t * (roadBot + 6 - _localY(492));
    c.drawRect(
      ui.Rect.fromLTWH(px, py, 2 + rand.next() * 2, 1.5),
      ui.Paint()..color = _rgba(160, 144, 116, 0.5),
    );
  }

  // Grass tufts — three quick strokes each.
  const tuftColors = <ui.Color>[
    ui.Color(0xFF5A6440),
    ui.Color(0xFF6E7A4A),
    ui.Color(0xFF49542F),
    ui.Color(0xFF77824E),
  ];
  final tuftPaint = ui.Paint()..strokeWidth = 1.3;
  for (var t = 0; t < 620; t++) {
    final px = rand.next() * w;
    final py = rand.next() * h;
    if (py > roadTop - 4 && py < roadBot + 4) continue;
    tuftPaint.color = tuftColors[(rand.next() * tuftColors.length).toInt()];
    final tuft = ui.Path();
    for (var b = 0; b < 3; b++) {
      final bx = px + (b - 1) * 2.4;
      tuft.moveTo(bx, py);
      tuft.lineTo(bx + (rand.next() - 0.5) * 4, py - 4 - rand.next() * 6);
    }
    c.drawPath(tuft, tuftPaint);
  }
  // Fallen leaves / litter dots.
  for (var t = 0; t < 240; t++) {
    final px = rand.next() * w;
    final py = rand.next() * h;
    c.drawRect(
      ui.Rect.fromLTWH(px, py, 2.4, 1.6),
      ui.Paint()
        ..color = rand.next() < 0.5
            ? _rgba(138, 122, 74, 0.6)
            : _rgba(90, 84, 52, 0.55),
    );
  }
  // Small stones.
  for (var t = 0; t < 120; t++) {
    final px = rand.next() * w;
    final py = rand.next() * h;
    final s = 1.6 + rand.next() * 3.4;
    c.drawOval(
      ui.Rect.fromCenter(
        center: ui.Offset(px, py),
        width: s * 2,
        height: s * 1.24,
      ),
      ui.Paint()..color = const ui.Color(0xFF6C675C),
    );
    c.drawRect(
      ui.Rect.fromLTWH(px - s * 0.4, py - s * 0.5, s * 0.7, s * 0.3),
      ui.Paint()..color = _rgba(190, 182, 166, 0.5),
    );
  }

  // Arena boundary: weathered concrete curb + short barrier posts.
  c.drawRect(const ui.Rect.fromLTWH(0, 0, w, 5), ui.Paint()..color = const ui.Color(0xFF57544C));
  c.drawRect(ui.Rect.fromLTWH(0, h - 6, w, 6), ui.Paint()..color = const ui.Color(0xFF57544C));
  for (var px = 8.0; px < w; px += 88) {
    c.drawRect(ui.Rect.fromLTWH(px, h - 20, 7, 15), ui.Paint()..color = const ui.Color(0xFF454239));
    c.drawRect(ui.Rect.fromLTWH(px + 1, h - 20, 2, 15), ui.Paint()..color = const ui.Color(0xFF6A675E));
  }
  // Chain-link fence hint along the horizon.
  c.drawLine(
    const ui.Offset(0, 7),
    const ui.Offset(w, 7),
    ui.Paint()
      ..color = _rgba(70, 66, 60, 0.85)
      ..strokeWidth = 1.6,
  );
  final meshPaint = ui.Paint()
    ..color = _rgba(90, 86, 78, 0.5)
    ..strokeWidth = 1;
  final mesh = ui.Path();
  for (var px = 0.0; px < w; px += 10) {
    mesh.moveTo(px, 2);
    mesh.lineTo(px + 6, 9);
    mesh.moveTo(px + 6, 2);
    mesh.lineTo(px, 9);
  }
  c.drawPath(mesh, meshPaint);

  // Corner vignette so the arena edges melt into the frame.
  c.drawRect(
    ui.Rect.fromLTWH(0, 0, w, h),
    ui.Paint()
      ..shader = ui.Gradient.radial(
        ui.Offset(w / 2, h * 0.5),
        h * 1.05,
        [
          const ui.Color(0x00000000),
          _rgba(8, 10, 6, 0.34),
        ],
        [_stop(0, h * 0.4, h * 1.05), 1.0],
      ),
  );
  return recorder.endRecording();
}

// ------------------------------------------------------- themed structures

void _brickWallFace(ui.Canvas c, double w, double h, int seed) {
  final rand = _Rng(seed);
  // Course gradient.
  c.drawRect(
    ui.Rect.fromLTWH(0, 0, w, h),
    ui.Paint()
      ..shader = ui.Gradient.linear(
        const ui.Offset(0, 0),
        ui.Offset(0, h),
        const [ui.Color(0xFF6D4234), ui.Color(0xFF4E2F26)],
      ),
  );
  // Broken crown: nibble the top edge.
  final nibbles = <double>[];
  var nx = 0.0;
  while (nx < w) {
    nibbles.add(nx);
    nx += 12 + rand.next() * 22;
  }
  for (final bx in nibbles) {
    final bh = 3 + rand.next() * 12;
    c.drawRect(
      ui.Rect.fromLTWH(bx, 0, 6 + rand.next() * 12, bh),
      ui.Paint()..color = const ui.Color(0xFF20160F),
    );
  }
  // Brick courses.
  const rowH = 11.0;
  const brickW = 24.0;
  for (var ry = 0; ry * rowH < h; ry++) {
    final off = (ry % 2) * (brickW / 2);
    for (var bx = -brickW; bx < w; bx += brickW) {
      final tint = rand.next();
      if (tint < 0.14) continue; // missing brick (hole)
      c.drawRect(
        ui.Rect.fromLTWH(bx + off + 1.2, ry * rowH + 1.2, brickW - 2.4, rowH - 2.4),
        ui.Paint()
          ..color = tint < 0.38
              ? _cBrickDark
              : tint < 0.72
                  ? _cBrick
                  : tint < 0.9
                      ? _cBrickLight
                      : const ui.Color(0xFF6A4030),
      );
      if (tint > 0.82) {
        c.drawRect(
          ui.Rect.fromLTWH(bx + off + 1.2, ry * rowH + 1.2, brickW - 2.4, 2),
          ui.Paint()..color = _rgba(255, 220, 190, 0.12),
        );
      }
    }
  }
  // Holes revealing dark interior.
  for (var k = 0; k < 4; k++) {
    final hx = rand.next() * (w - 30) + 8;
    final hy = 8 + rand.next() * (h - 26);
    c.drawOval(
      ui.Rect.fromCenter(
        center: ui.Offset(hx, hy),
        width: 2 * (7 + rand.next() * 9),
        height: 2 * (5 + rand.next() * 6),
      ),
      ui.Paint()..color = const ui.Color(0xFF170F0B),
    );
  }
  // Moss + grime at the base.
  c.drawRect(
    ui.Rect.fromLTWH(0, h * 0.55, w, h * 0.45),
    ui.Paint()
      ..shader = ui.Gradient.linear(
        ui.Offset(0, h * 0.55),
        ui.Offset(0, h),
        [_rgba(60, 70, 40, 0.0), _rgba(52, 64, 36, 0.55)],
      ),
  );
  for (var k = 0; k < 8; k++) {
    final mx = rand.next() * w;
    c.drawOval(
      ui.Rect.fromCenter(
        center: ui.Offset(mx, h - 4 - rand.next() * 10),
        width: 2 * (6 + rand.next() * 10),
        height: 2 * (3 + rand.next() * 4),
      ),
      ui.Paint()..color = _rgba(74, 86, 48, 0.5),
    );
  }
  // Painted faded stripe (society boundary marker).
  c.drawRect(
    ui.Rect.fromLTWH(0, h * 0.34, w, 7),
    ui.Paint()..color = _rgba(214, 196, 150, 0.16),
  );
}

void _restaurantFace(ui.Canvas c, double w, double h, int seed) {
  final rand = _Rng(seed);
  // Weathered plaster.
  c.drawRect(
    ui.Rect.fromLTWH(0, 0, w, h),
    ui.Paint()
      ..shader = ui.Gradient.linear(
        const ui.Offset(0, 0),
        ui.Offset(0, h),
        const [_cPlasterLight, _cPlaster, ui.Color(0xFF93866E)],
        const [0.0, 0.55, 1.0],
      ),
  );
  // Stain streaks.
  for (var k = 0; k < 14; k++) {
    final sx = rand.next() * w;
    final alpha = 0.08 + rand.next() * 0.12;
    final sy = rand.next() * h * 0.3;
    final sw = 2 + rand.next() * 6;
    final sh = h * (0.3 + rand.next() * 0.5);
    c.drawRect(
      ui.Rect.fromLTWH(sx, sy, sw, sh),
      ui.Paint()..color = _rgba(70, 60, 44, alpha),
    );
  }
  // Cracks.
  final crackPaint = ui.Paint()
    ..color = _rgba(60, 50, 40, 0.55)
    ..strokeWidth = 1.1;
  final crackPath = ui.Path();
  for (var k = 0; k < 5; k++) {
    var cx = rand.next() * w;
    var cy = rand.next() * h * 0.4;
    crackPath.moveTo(cx, cy);
    for (var s = 0; s < 5; s++) {
      cx += (rand.next() - 0.5) * 22;
      cy += 8 + rand.next() * 14;
      crackPath.lineTo(cx, cy);
    }
  }
  c.drawPath(crackPath, crackPaint);

  const signH = 22.0;
  const signY = 8.0;
  // Signboard.
  c.drawRect(
    ui.Rect.fromLTWH(6, signY, w - 12, signH),
    ui.Paint()..color = const ui.Color(0xFF2E2A26),
  );
  c.drawRect(
    ui.Rect.fromLTWH(6, signY, w - 12, signH),
    ui.Paint()
      ..color = _rgba(0, 0, 0, 0.6)
      ..style = ui.PaintingStyle.stroke
      ..strokeWidth = 2,
  );
  // Dead tube lights along the sign.
  final tubePaint = ui.Paint()..color = _rgba(230, 220, 190, 0.25);
  for (var k = 0; k < 6; k++) {
    c.drawRect(
      ui.Rect.fromLTWH(14 + k * ((w - 28) / 6), signY - 4, (w - 28) / 6 - 8, 2.5),
      tubePaint,
    );
  }
  // Faded name (light fill, then a dark copy offset by 1px for the embossed
  // look — same as the two web fillText calls). TextPainter anchors at the
  // top of the laid-out text, so shift by the distance to the baseline.
  void paintName(ui.Color color, double ox, double oy) {
    final tp = TextPainter(
      text: TextSpan(
        text: '★ STARLIGHT RESTAURANT ★',
        style: TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.bold,
          fontFamily: 'monospace',
          color: color,
        ),
      ),
      textDirection: ui.TextDirection.ltr,
    )..layout();
    final baseline = signY + 15.5 + oy;
    tp.paint(
      c,
      ui.Offset(
        (w - tp.width) / 2 + ox,
        baseline - tp.computeDistanceToActualBaseline(TextBaseline.alphabetic),
      ),
    );
  }

  paintName(_rgba(216, 201, 160, 0.8), 0, 0);
  paintName(_rgba(40, 34, 28, 0.35), 1, 1);

  // Torn striped awning under the sign.
  final awnY = signY + signH + 3;
  const stripeW = 16.0;
  for (var sx = 6.0; sx < w - 6; sx += stripeW) {
    final torn = rand.next();
    final stripeColor = (sx / stripeW).toInt().isEven
        ? const ui.Color(0xFF9A4A3C)
        : const ui.Color(0xFFCBB89A);
    if (torn < 0.18) {
      // ripped chunk missing
      c.save();
      c.clipRect(ui.Rect.fromLTWH(sx, awnY, stripeW, 12));
      c.drawRect(
        ui.Rect.fromLTWH(sx, awnY + 4 + rand.next() * 4, stripeW, 8),
        ui.Paint()..color = stripeColor,
      );
      c.restore();
    } else {
      c.drawRect(
        ui.Rect.fromLTWH(sx, awnY, stripeW, 13),
        ui.Paint()..color = stripeColor,
      );
      c.drawRect(
        ui.Rect.fromLTWH(sx, awnY + 10, stripeW, 3),
        ui.Paint()..color = _rgba(0, 0, 0, 0.22),
      );
    }
  }
  c.drawRect(
    ui.Rect.fromLTWH(6, awnY + 13, w - 12, 2.5),
    ui.Paint()..color = _rgba(40, 30, 24, 0.35),
  );

  // Boarded window (left) + shuttered door (right).
  const winX = 20.0;
  const winW = 72.0;
  const winH = 34.0;
  final winY = awnY + 22;
  c.drawRect(
    ui.Rect.fromLTWH(winX, winY, winW, winH),
    ui.Paint()..color = const ui.Color(0xFF1C1713),
  );
  c.drawRect(
    ui.Rect.fromLTWH(winX, winY, winW, winH),
    ui.Paint()
      ..color = const ui.Color(0xFF54402F)
      ..style = ui.PaintingStyle.stroke
      ..strokeWidth = 3,
  );
  for (var p = 0; p < 4; p++) {
    c.save();
    c.translate(winX, winY + 3 + p * 8);
    c.rotate((rand.next() - 0.5) * 0.06);
    c.drawRect(
      ui.Rect.fromLTWH(0, 0, winW, 6),
      ui.Paint()
        ..color = p.isOdd
            ? const ui.Color(0xFF5E4A38)
            : const ui.Color(0xFF6D5741),
    );
    c.restore();
  }
  final doorX = w - 66;
  const doorW = 48.0;
  final doorY = winY - 4;
  final doorH = h - doorY - 6;
  // Rusted roller shutter.
  c.drawRect(
    ui.Rect.fromLTWH(doorX, doorY, doorW, doorH),
    ui.Paint()
      ..shader = ui.Gradient.linear(
        ui.Offset(doorX, 0),
        ui.Offset(doorX + doorW, 0),
        const [ui.Color(0xFF6A6E74), ui.Color(0xFF7D8288), ui.Color(0xFF5E6268)],
        const [0.0, 0.5, 1.0],
      ),
  );
  final slatPaint = ui.Paint()
    ..color = _rgba(40, 42, 46, 0.8)
    ..strokeWidth = 1;
  final slats = ui.Path();
  for (var ry = doorY + 4; ry < doorY + doorH; ry += 5) {
    slats.moveTo(doorX, ry);
    slats.lineTo(doorX + doorW, ry);
  }
  c.drawPath(slats, slatPaint);
  // Rust streaks on the shutter.
  for (var k = 0; k < 6; k++) {
    final alpha = 0.25 + rand.next() * 0.3;
    final rx = doorX + rand.next() * doorW;
    final ry = doorY + rand.next() * doorH * 0.5;
    final rw = 3 + rand.next() * 5;
    final rh = 8 + rand.next() * 20;
    c.drawRect(
      ui.Rect.fromLTWH(rx, ry, rw, rh),
      ui.Paint()..color = _rgba(122, 74, 48, alpha),
    );
  }
  // Padlock + handle plate.
  c.drawRect(
    ui.Rect.fromLTWH(doorX + doorW * 0.5 - 5, doorY + doorH * 0.62, 10, 12),
    ui.Paint()..color = const ui.Color(0xFF3A3A3C),
  );
  // Middle pillar between window and door.
  c.drawRect(
    ui.Rect.fromLTWH(winX + winW + 8, winY - 8, 6, h - winY),
    ui.Paint()..color = _rgba(0, 0, 0, 0.08),
  );

  // Base: grime + step slab.
  c.drawRect(
    ui.Rect.fromLTWH(0, h * 0.75, w, h * 0.25),
    ui.Paint()
      ..shader = ui.Gradient.linear(
        ui.Offset(0, h * 0.75),
        ui.Offset(0, h),
        [_rgba(40, 36, 28, 0.0), _rgba(40, 36, 28, 0.5)],
      ),
  );
  c.drawRect(
    ui.Rect.fromLTWH(8, h - 7, w - 16, 7),
    ui.Paint()..color = const ui.Color(0xFF8F887A),
  );
  c.drawRect(
    ui.Rect.fromLTWH(8, h - 2.5, w - 16, 2.5),
    ui.Paint()..color = _rgba(0, 0, 0, 0.3),
  );

  // Vandal tags (subtle).
  final tagPaint = ui.Paint()
    ..color = _rgba(160, 60, 60, 0.28)
    ..strokeWidth = 2.4;
  final tagPath = ui.Path()
    ..moveTo(w * 0.42, winY + 6)
    ..quadraticBezierTo(w * 0.47, winY - 8, w * 0.53, winY + 4);
  c.drawPath(tagPath, tagPaint);
}

void _kioskFace(ui.Canvas c, double w, double h, int seed) {
  final rand = _Rng(seed);
  // Wooden plank front.
  c.drawRect(ui.Rect.fromLTWH(0, 0, w, h), ui.Paint()..color = _cWood);
  const plankH = 12.0;
  for (var py = 0.0; py < h; py += plankH) {
    final tint = rand.next();
    c.drawRect(
      ui.Rect.fromLTWH(0, py, w, plankH - 1.4),
      ui.Paint()
        ..color = tint < 0.5
            ? _cWood
            : (rand.next() < 0.5 ? _cWoodLight : const ui.Color(0xFF5F4832)),
    );
    c.drawRect(
      ui.Rect.fromLTWH(0, py + plankH - 1.4, w, 1.4),
      ui.Paint()..color = _rgba(0, 0, 0, 0.35),
    );
    // Knots.
    if (rand.next() < 0.4) {
      c.drawOval(
        ui.Rect.fromCenter(
          center: ui.Offset(rand.next() * w, py + plankH / 2),
          width: 4.8,
          height: 3.2,
        ),
        ui.Paint()..color = _rgba(58, 44, 30, 0.7),
      );
    }
  }
  // Open counter: dark opening with shelf.
  final cX = w * 0.3;
  final cW = w * 0.4;
  const cY = 14.0;
  final cH = h - cY - 12;
  c.drawRect(
    ui.Rect.fromLTWH(cX, cY, cW, cH),
    ui.Paint()..color = const ui.Color(0xFF181410),
  );
  c.drawRect(
    ui.Rect.fromLTWH(cX - 6, cY + cH * 0.45, cW + 12, 5),
    ui.Paint()..color = const ui.Color(0xFF241D16),
  );
  // Hanging strips (old plastic curtain).
  for (var sx = cX + 3; sx < cX + cW - 3; sx += 7) {
    final alpha = 0.16 + rand.next() * 0.14;
    final stripH = cH * (0.4 + rand.next() * 0.5);
    c.drawRect(
      ui.Rect.fromLTWH(sx, cY, 3, stripH),
      ui.Paint()..color = _rgba(150, 150, 140, alpha),
    );
  }
  // Torn tarp over the right corner.
  final tarp = ui.Path()
    ..moveTo(w - 46, 8)
    ..lineTo(w - 6, 14)
    ..lineTo(w - 12, 34 + rand.next() * 10)
    ..lineTo(w - 40, 26)
    ..close();
  c.drawPath(tarp, ui.Paint()..color = _rgba(138, 142, 150, 0.85));
  c.drawRect(
    ui.Rect.fromLTWH(w - 34, 12, 18, 3),
    ui.Paint()..color = _rgba(70, 74, 80, 0.6),
  );
  // Grime + moss base.
  c.drawRect(
    ui.Rect.fromLTWH(0, h * 0.7, w, h * 0.3),
    ui.Paint()
      ..shader = ui.Gradient.linear(
        ui.Offset(0, h * 0.7),
        ui.Offset(0, h),
        [_rgba(30, 30, 20, 0.0), _rgba(30, 34, 18, 0.5)],
      ),
  );
  // Crates beside the counter.
  c.drawRect(
    ui.Rect.fromLTWH(w - 34, h - 20, 22, 18),
    ui.Paint()..color = const ui.Color(0xFF7A5C3A),
  );
  final cratePaint = ui.Paint()
    ..color = _rgba(40, 28, 16, 0.8)
    ..style = ui.PaintingStyle.stroke
    ..strokeWidth = 1.6;
  c.drawRect(ui.Rect.fromLTWH(w - 34, h - 20, 22, 18), cratePaint);
  final crateCross = ui.Path()
    ..moveTo(w - 34, h - 20)
    ..lineTo(w - 12, h - 2)
    ..moveTo(w - 12, h - 20)
    ..lineTo(w - 34, h - 2);
  c.drawPath(crateCross, cratePaint);
  c.drawRect(
    ui.Rect.fromLTWH(w - 30, h - 34, 18, 14),
    ui.Paint()..color = const ui.Color(0xFF6A4E30),
  );
  c.drawRect(ui.Rect.fromLTWH(w - 30, h - 34, 18, 14), cratePaint);
}

void _cabinFace(ui.Canvas c, double w, double h, int seed) {
  final rand = _Rng(seed);
  // Aging plaster cabin.
  c.drawRect(
    ui.Rect.fromLTWH(0, 0, w, h),
    ui.Paint()
      ..shader = ui.Gradient.linear(
        const ui.Offset(0, 0),
        ui.Offset(0, h),
        const [ui.Color(0xFF9A9282), ui.Color(0xFF6E675C)],
      ),
  );
  // Plaster patches falling off → brick underneath. (The web source calls
  // rand() again inside the strokeRect, so the stroked rect differs by a
  // hair from the filled one — replicated here on purpose.)
  for (var k = 0; k < 7; k++) {
    final px = rand.next() * (w - 26);
    final py = h * 0.3 + rand.next() * h * 0.55;
    c.drawRect(
      ui.Rect.fromLTWH(px, py, 12 + rand.next() * 22, 8 + rand.next() * 12),
      ui.Paint()..color = _cBrickDark,
    );
    c.drawRect(
      ui.Rect.fromLTWH(px, py, 12 + rand.next() * 22, 8 + rand.next() * 12),
      ui.Paint()
        ..color = _rgba(0, 0, 0, 0.3)
        ..style = ui.PaintingStyle.stroke
        ..strokeWidth = 1,
    );
  }
  // Broken window with shards.
  final wx = w * 0.22;
  const wy = 12.0;
  const ww = 52.0;
  const wh = 30.0;
  c.drawRect(
    ui.Rect.fromLTWH(wx, wy, ww, wh),
    ui.Paint()..color = const ui.Color(0xFF141A1E),
  );
  c.drawRect(
    ui.Rect.fromLTWH(wx, wy, ww, wh),
    ui.Paint()
      ..color = const ui.Color(0xFF4A4238)
      ..style = ui.PaintingStyle.stroke
      ..strokeWidth = 3,
  );
  final shardPaint = ui.Paint()
    ..color = _rgba(170, 200, 210, 0.4)
    ..strokeWidth = 1.4;
  final shards = ui.Path();
  for (var k = 0; k < 5; k++) {
    final sx = wx + 4 + rand.next() * (ww - 8);
    final sy = wy + 2 + rand.next() * 8;
    shards.moveTo(sx, sy);
    shards.lineTo(sx + (rand.next() - 0.5) * 8, sy + 6 + rand.next() * 10);
  }
  c.drawPath(shards, shardPaint);
  // Door.
  c.drawRect(
    ui.Rect.fromLTWH(w - 60, wy - 2, 42, h - wy + 2),
    ui.Paint()..color = const ui.Color(0xFF4E4438),
  );
  c.drawRect(
    ui.Rect.fromLTWH(w - 60, wy - 2, 42, h - wy + 2),
    ui.Paint()
      ..color = _rgba(0, 0, 0, 0.4)
      ..style = ui.PaintingStyle.stroke
      ..strokeWidth = 1,
  );
  // Rusted tin roof strip along the top.
  c.drawRect(ui.Rect.fromLTWH(0, 0, w, 7), ui.Paint()..color = _cRust);
  c.drawRect(
    ui.Rect.fromLTWH(0, 5, w, 2),
    ui.Paint()..color = _rgba(0, 0, 0, 0.3),
  );
  // Barrier pole leaning against the wall.
  c.drawLine(
    ui.Offset(10, h - 2),
    const ui.Offset(34, 6),
    ui.Paint()
      ..color = const ui.Color(0xFFC8C0AE)
      ..strokeWidth = 4,
  );
  c.save();
  c.translate(24, 30);
  c.rotate(-0.42);
  final bandPaint = ui.Paint()..color = const ui.Color(0xFFB03A30);
  c.drawRect(ui.Rect.fromLTWH(-2, 0, 4, 9), bandPaint);
  c.drawRect(ui.Rect.fromLTWH(-2, 16, 4, 9), bandPaint);
  c.restore();
  // Base grime.
  c.drawRect(
    ui.Rect.fromLTWH(0, h * 0.72, w, h * 0.28),
    ui.Paint()
      ..shader = ui.Gradient.linear(
        ui.Offset(0, h * 0.72),
        ui.Offset(0, h),
        [_rgba(28, 26, 20, 0.0), _rgba(28, 26, 20, 0.5)],
      ),
  );
}

ui.Picture _bakeStructure(int index, double w) {
  final h = kStructHeights[index];
  final recorder = ui.PictureRecorder();
  final c = recorder.beginRecording(ui.Rect.fromLTWH(0, 0, w, h));
  switch (index) {
    case 0:
      _brickWallFace(c, w, h, 0xB100 + 7);
    case 1:
      _brickWallFace(c, w, h, 0xB200 + 11);
    case 2:
      _kioskFace(c, w, h, 0xC200 + 3);
    case 3:
      _restaurantFace(c, w, h, 0xD300 + 5);
    default:
      _cabinFace(c, w, h, 0xE400 + 9);
  }
  return recorder.endRecording();
}

/// Draw the themed cover for obstacle [index]: baked front face + live top
/// face (footprint) + ground shadow. Fully decorative — collisions unchanged.
void drawStructure(ui.Canvas canvas, int index, List<double> ob) {
  final h = kStructHeights[index];
  final yFar = groundY(ob[1]);
  final yNear = groundY(ob[1] + ob[3]);

  // Ground shadow puddle in front.
  canvas.drawOval(
    ui.Rect.fromCenter(
      center: ui.Offset(ob[0] + ob[2] / 2, yNear + 5),
      width: ob[2] * 1.1,
      height: 20,
    ),
    ui.Paint()..color = _cShadow,
  );

  // Front face (baked art).
  canvas.save();
  canvas.translate(ob[0], yNear - h);
  canvas.drawPicture(_structPic(index, ob[2]));
  canvas.restore();

  // Top face — weathered roof/deck between the far and near edges.
  final topH = yNear - yFar;
  final List<ui.Color> roofColors;
  if (index == 3) {
    roofColors = const [ui.Color(0xFF77726A), ui.Color(0xFF5D5850)];
  } else if (index == 0 || index == 1) {
    roofColors = const [ui.Color(0xFF8A8578), ui.Color(0xFF6E6A5E)];
  } else {
    roofColors = const [_cTin, _cTinDark];
  }
  canvas.drawRect(
    ui.Rect.fromLTWH(ob[0], yFar - h, ob[2], topH),
    ui.Paint()
      ..shader = ui.Gradient.linear(
        ui.Offset(0, yFar - h),
        ui.Offset(0, yFar - h + topH),
        roofColors,
      ),
  );
  // Roof clutter: gravel speckle + vents / broken tiles.
  final rand = _Rng(0x71EF + index * 41);
  final specklePaint = ui.Paint()..color = _rgba(255, 255, 255, 0.07);
  for (var k = 0; k < 40; k++) {
    canvas.drawRect(
      ui.Rect.fromLTWH(
        ob[0] + rand.next() * ob[2],
        yFar - h + rand.next() * topH,
        2,
        1.4,
      ),
      specklePaint,
    );
  }
  if (index == 3) {
    // Water tank + vent pipe on the restaurant roof.
    canvas.drawRect(
      ui.Rect.fromLTWH(ob[0] + 12, yFar - h - 9, 22, 11),
      ui.Paint()..color = const ui.Color(0xFF3C4044),
    );
    canvas.drawRect(
      ui.Rect.fromLTWH(ob[0] + 12, yFar - h - 11, 22, 3),
      ui.Paint()..color = const ui.Color(0xFF565B60),
    );
    canvas.drawLine(
      ui.Offset(ob[0] + ob[2] - 30, yFar - h),
      ui.Offset(ob[0] + ob[2] - 30, yFar - h - 14),
      ui.Paint()
        ..color = const ui.Color(0xFF4A4E52)
        ..strokeWidth = 3,
    );
    // Parapet edge.
    canvas.drawRect(
      ui.Rect.fromLTWH(ob[0], yFar - h + topH - 3, ob[2], 3),
      ui.Paint()..color = const ui.Color(0xFF8A8478),
    );
  } else if (index >= 2) {
    // Corrugated ribs on the tin roofs.
    final ribPaint = ui.Paint()
      ..color = _rgba(255, 255, 255, 0.10)
      ..strokeWidth = 1.2;
    final ribs = ui.Path();
    for (var rx = ob[0] + 6; rx < ob[0] + ob[2]; rx += 9) {
      ribs.moveTo(rx, yFar - h);
      ribs.lineTo(rx, yFar - h + topH);
    }
    canvas.drawPath(ribs, ribPaint);
  } else {
    // Rubble along the wall top.
    for (var k = 0; k < 12; k++) {
      final rubbleColor = rand.next() < 0.5
          ? const ui.Color(0xFF6A4030)
          : const ui.Color(0xFF7C4A38);
      final rx = ob[0] + rand.next() * ob[2];
      final ry = yFar - h - 2 - rand.next() * 4;
      final rw = 4 + rand.next() * 5;
      final rh = 3 + rand.next() * 3;
      canvas.drawRect(
        ui.Rect.fromLTWH(rx, ry, rw, rh),
        ui.Paint()..color = rubbleColor,
      );
    }
  }
  // Rebar on the broken brick walls.
  if (index <= 1) {
    final rebarPaint = ui.Paint()
      ..color = const ui.Color(0xFF3A2C22)
      ..strokeWidth = 1.6;
    final rebar = ui.Path();
    for (var k = 0; k < 5; k++) {
      final rx = ob[0] + 20 + rand.next() * (ob[2] - 40);
      final rh = 6 + rand.next() * 10;
      rebar.moveTo(rx, yFar - h);
      rebar.lineTo(rx + 2, yFar - h - rh);
    }
    canvas.drawPath(rebar, rebarPaint);
  }
  // Outline for readability.
  canvas.drawRect(
    ui.Rect.fromLTWH(ob[0], yFar - h, ob[2], topH + h),
    ui.Paint()
      ..color = _rgba(15, 12, 10, 0.55)
      ..style = ui.PaintingStyle.stroke
      ..strokeWidth = 1.4,
  );
}

// ------------------------------------------------------------------- scenery

void _drawTree(ui.Canvas canvas, Decor d, double t) {
  final ax = d.x;
  final ay = groundY(d.y);
  final s = 52 * d.scale;
  final sway = math.sin(t * 1.1 + d.variant * 1.7) * 0.028 +
      math.sin(t * 2.3 + d.variant) * 0.012;

  // Shadow.
  canvas.drawOval(
    ui.Rect.fromCenter(
      center: ui.Offset(ax + 6, ay + 3),
      width: s * 1.1,
      height: s * 0.28,
    ),
    ui.Paint()..color = _rgba(10, 12, 8, 0.4),
  );

  final lean = sway * s;
  if (d.dead) {
    // Bare dead tree — recursive-ish branches.
    final branchPaint = ui.Paint()
      ..color = _cDeadWood
      ..strokeCap = ui.StrokeCap.round;
    final topX = ax + lean;
    final topY = ay - s * 1.75;
    branchPaint.strokeWidth = s * 0.09;
    canvas.drawPath(
      ui.Path()
        ..moveTo(ax, ay)
        ..quadraticBezierTo(ax + s * 0.06, ay - s * 0.9, topX, topY),
      branchPaint,
    );
    void branch(double x0, double y0, double ang, double len, double w, int depth) {
      if (depth == 0 || len < 4) return;
      final x1 = x0 + math.cos(ang) * len;
      final y1 = y0 + math.sin(ang) * len;
      branchPaint.strokeWidth = w;
      canvas.drawLine(ui.Offset(x0, y0), ui.Offset(x1, y1), branchPaint);
      branch(x1, y1, ang - 0.42 - sway * 0.4, len * 0.68, w * 0.6, depth - 1);
      branch(x1, y1, ang + 0.38 + sway * 0.4, len * 0.66, w * 0.6, depth - 1);
    }

    final tipX = ax + lean;
    final tipY = ay - s * 1.75;
    branch(tipX, tipY + s * 0.35, -math.pi / 2 - 0.65 + sway, s * 0.5, s * 0.06, 3);
    branch(tipX, tipY + s * 0.55, -math.pi / 2 + 0.6 + sway, s * 0.55, s * 0.07, 3);
    branch(tipX, tipY + s * 0.15, -math.pi / 2 + 0.18 + sway * 0.5, s * 0.4, s * 0.05, 2);
    return;
  }

  // Living tree: trunk + layered canopy blobs.
  final trunkPaint = ui.Paint()
    ..color = const ui.Color(0xFF3E332A)
    ..strokeCap = ui.StrokeCap.round
    ..strokeWidth = s * 0.13;
  canvas.drawPath(
    ui.Path()
      ..moveTo(ax, ay)
      ..quadraticBezierTo(ax + s * 0.05, ay - s * 0.8, ax + lean, ay - s * 1.35),
    trunkPaint,
  );
  // Branch stubs.
  trunkPaint.strokeWidth = s * 0.06;
  canvas.drawPath(
    ui.Path()
      ..moveTo(ax + s * 0.02, ay - s * 0.85)
      ..lineTo(ax - s * 0.34 + lean * 0.6, ay - s * 1.15)
      ..moveTo(ax + s * 0.03, ay - s * 1.0)
      ..lineTo(ax + s * 0.38 + lean * 0.6, ay - s * 1.28),
    trunkPaint,
  );

  final cy = ay - s * 1.62;
  final cx = ax + lean * 1.6;
  const blobs = <(double, double, double)>[
    (0.0, 0.0, 0.62),
    (-0.42, 0.16, 0.44),
    (0.44, 0.12, 0.46),
    (-0.18, -0.3, 0.4),
    (0.24, -0.26, 0.38),
  ];
  for (final (ox, oy, r) in blobs) {
    canvas.drawOval(
      ui.Rect.fromCenter(
        center: ui.Offset(cx + ox * s, cy + oy * s),
        width: r * s * 2,
        height: r * s * 1.72,
      ),
      ui.Paint()..color = _cLeafDark,
    );
  }
  for (final (ox, oy, r) in blobs) {
    canvas.drawOval(
      ui.Rect.fromCenter(
        center: ui.Offset(cx + ox * s - 1.5, cy + oy * s - 2.5),
        width: r * s * 1.8,
        height: r * s * 1.52,
      ),
      ui.Paint()..color = _cLeaf,
    );
  }
  // Sun-side highlights.
  for (final (ox, oy, r) in blobs) {
    canvas.drawOval(
      ui.Rect.fromCenter(
        center: ui.Offset(cx + ox * s + r * s * 0.24, cy + oy * s - r * s * 0.3),
        width: r * s * 0.84,
        height: r * s * 0.6,
      ),
      ui.Paint()..color = _cLeafLight,
    );
  }
}

void _drawBush(ui.Canvas canvas, Decor d, double t) {
  final ax = d.x;
  final ay = groundY(d.y);
  final s = 20 * d.scale;
  final sway = math.sin(t * 1.6 + d.variant * 2.1) * 0.05;

  canvas.drawOval(
    ui.Rect.fromCenter(
      center: ui.Offset(ax, ay + 2),
      width: s * 2.2,
      height: s * 0.48,
    ),
    ui.Paint()..color = _rgba(10, 12, 8, 0.35),
  );

  const blobs = <(double, double, double)>[
    (-0.6, -0.2, 0.62),
    (0.55, -0.15, 0.58),
    (0.0, -0.5, 0.66),
  ];
  for (final (ox, oy, r) in blobs) {
    canvas.drawOval(
      ui.Rect.fromCenter(
        center: ui.Offset(ax + ox * s * (1 + sway), ay - oy * s),
        width: r * s * 2,
        height: r * s * 1.56,
      ),
      ui.Paint()..color = _cLeafDark,
    );
  }
  for (final (ox, oy, r) in blobs) {
    canvas.drawOval(
      ui.Rect.fromCenter(
        center: ui.Offset(ax + ox * s * (1 + sway) - 1, ay - oy * s - 1.5),
        width: r * s * 1.64,
        height: r * s * 1.2,
      ),
      ui.Paint()..color = _cLeaf,
    );
  }
  canvas.drawOval(
    ui.Rect.fromCenter(
      center: ui.Offset(ax + s * 0.18, ay - s * 0.72),
      width: s * 0.68,
      height: s * 0.44,
    ),
    ui.Paint()..color = _cLeafLight,
  );
}

void _drawRock(ui.Canvas canvas, Decor d) {
  final ax = d.x;
  final ay = groundY(d.y);
  final s = 9 * d.scale;
  canvas.drawOval(
    ui.Rect.fromCenter(
      center: ui.Offset(ax + 1, ay + 1.5),
      width: s * 2.3,
      height: s * 0.6,
    ),
    ui.Paint()..color = _rgba(10, 12, 8, 0.35),
  );
  canvas.drawPath(
    ui.Path()
      ..moveTo(ax - s, ay)
      ..lineTo(ax - s * 0.6, ay - s * 0.85)
      ..lineTo(ax + s * 0.2, ay - s)
      ..lineTo(ax + s, ay - s * 0.35)
      ..lineTo(ax + s * 0.9, ay)
      ..close(),
    ui.Paint()..color = const ui.Color(0xFF6C675C),
  );
  canvas.drawPath(
    ui.Path()
      ..moveTo(ax - s * 0.6, ay - s * 0.85)
      ..lineTo(ax + s * 0.2, ay - s)
      ..lineTo(ax + s * 0.3, ay - s * 0.5)
      ..close(),
    ui.Paint()..color = const ui.Color(0xFF847E70),
  );
}

/// Draw one scenery prop (sway animated by [t]).
void drawDecor(ui.Canvas canvas, Decor d, double t) {
  if (d.kind == 'tree') {
    _drawTree(canvas, d, t);
  } else if (d.kind == 'bush') {
    _drawBush(canvas, d, t);
  } else {
    _drawRock(canvas, d);
  }
}

// ------------------------------------------------------------------ ambience

class _Cloud {
  const _Cloud(this.x, this.y, this.s, this.v);

  final double x;
  final double y;
  final double s;
  final double v;
}

List<_Cloud>? _clouds;

List<_Cloud> _getClouds() {
  final cached = _clouds;
  if (cached != null) return cached;
  final rand = _Rng(0xC10D);
  final list = <_Cloud>[
    for (var i = 0; i < 6; i++)
      _Cloud(
        rand.next() * VsWorld.width,
        14 + rand.next() * 120, // web sky-canvas y; projected = y - 238
        0.6 + rand.next() * 1.1,
        4 + rand.next() * 7,
      ),
  ];
  return _clouds = list;
}

// ----------------------------------------------------------------- composite

/// Blit the baked sky; then live clouds + birds. The baked picture spans
/// projected y in [-400, 0] (horizon at 0).
void drawSky(ui.Canvas canvas, double t) {
  canvas.drawPicture(_skyPic());
  final cloudPaint = ui.Paint()..color = _rgba(160, 138, 118, 0.14);
  for (final c in _getClouds()) {
    final x = ((c.x + t * c.v) % (VsWorld.width + 260)) - 130;
    final y = c.y - kHorizon;
    final s = c.s;
    // Soft 3-ellipse blob, filled once like the web single path.
    final blob = ui.Path()
      ..addOval(
        ui.Rect.fromCenter(
          center: ui.Offset(x, y),
          width: 120 * s,
          height: 28 * s,
        ),
      )
      ..addOval(
        ui.Rect.fromCenter(
          center: ui.Offset(x + 34 * s, y - 8 * s),
          width: 80 * s,
          height: 24 * s,
        ),
      )
      ..addOval(
        ui.Rect.fromCenter(
          center: ui.Offset(x - 36 * s, y + 3 * s),
          width: 68 * s,
          height: 20 * s,
        ),
      );
    canvas.drawPath(blob, cloudPaint);
  }
  // Birds flapping across the sky.
  final birdPaint = ui.Paint()
    ..color = _rgba(30, 24, 20, 0.7)
    ..strokeWidth = 1.6;
  for (var b = 0; b < 5; b++) {
    final bx = ((b * 173 + t * (16 + b * 3)) % (VsWorld.width + 140)) - 70;
    final by = 44.0 + b * 13 + math.sin(t * 2 + b) * 5 - kHorizon;
    final flap = math.sin(t * 7 + b * 1.9) * 3;
    canvas.drawPath(
      ui.Path()
        ..moveTo(bx - 5, by - flap)
        ..quadraticBezierTo(bx, by + 2, bx + 5, by - flap),
      birdPaint,
    );
  }
}

/// Blit the baked ground (roads, paths, scatter, curbs) at the horizon.
void drawGround(ui.Canvas canvas) {
  canvas.drawPicture(_groundPic());
}
