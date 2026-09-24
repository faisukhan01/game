/// Small adapter so widgets can talk to the game without importing flame
/// types directly.
library;

import 'package:flutter/material.dart';

import '../game/voidstrike_game.dart';
import 'protocol_shim.dart';

extension GameInputBridge on VoidstrikeGame {
  /// Conversion factor from widget pixels to world units.
  double canvasScaleFor(Size screen) {
    final sx = screen.width / VsWorld.width;
    final sy = screen.height / VsWorld.height;
    return sx < sy ? sx : sy;
  }

  void aimFromScreen(Offset local, Size screen) {
    final scale = canvasScaleFor(screen);
    aimFromWorld(local.dx / scale, local.dy / scale);
  }

  void aimFromWorld(double wx, double wy) {
    final dx = wx - player.x;
    final dy = wy - player.y;
    final l2 = dx * dx + dy * dy;
    if (l2 > 1e-6) {
      final d = l2;
      aimX = dx / d;
      aimY = dy / d;
    }
  }
}
