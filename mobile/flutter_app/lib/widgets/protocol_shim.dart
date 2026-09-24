/// Small adapter so widgets can talk to the game without importing flame
/// types directly.
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../game/protocol.dart' show VsWorld;
import '../game/voidstrike_game.dart';

export '../game/voidstrike_game.dart' show MatchResult;

extension GameInputBridge on VoidstrikeGame {
  /// Conversion factor from widget pixels to world units (matches the
  /// FixedResolutionViewport letterbox scaling).
  double canvasScaleFor(Size screen) {
    final sx = screen.width / VsWorld.width;
    final sy = screen.height / VsWorld.height;
    return sx < sy ? sx : sy;
  }

  /// Widget-space point -> world-space point, compensating for the
  /// letterbox bars the fixed-resolution viewport centers in the widget.
  Offset screenToWorld(Offset local, Size screen) {
    final scale = canvasScaleFor(screen);
    final ox = (screen.width - VsWorld.width * scale) / 2;
    final oy = (screen.height - VsWorld.height * scale) / 2;
    return Offset((local.dx - ox) / scale, (local.dy - oy) / scale);
  }

  void aimFromScreen(Offset local, Size screen) {
    final w = screenToWorld(local, screen);
    aimFromWorld(w.dx, w.dy);
  }

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
}
