/// Small adapter so widgets can talk to the game without importing flame
/// types directly.
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../game/voidstrike_game.dart';

export '../game/voidstrike_game.dart' show MatchResult;

extension GameInputBridge on VoidstrikeGame {
  /// Widget-space point -> world-space point, compensating for the
  /// fixed-resolution viewport letterbox and the follow camera.
  Offset screenToWorldPoint(Offset local, Size screen) {
    final scale = math.min(screen.width / kViewW, screen.height / kViewH);
    final ox = (screen.width - kViewW * scale) / 2;
    final oy = (screen.height - kViewH * scale) / 2;
    return Offset(
      (local.dx - ox) / scale + camX,
      (local.dy - oy) / scale + camY,
    );
  }

  void aimFromScreen(Offset local, Size screen) {
    final w = screenToWorldPoint(local, screen);
    aimFromWorld(w.dx, w.dy);
  }
}
