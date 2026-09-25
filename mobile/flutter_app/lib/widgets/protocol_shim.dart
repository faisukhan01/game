/// Small adapter so widgets can talk to the game without importing flame
/// types directly.
library;

import 'dart:ui' as ui;

import '../game/voidstrike_game.dart';

export '../game/voidstrike_game.dart' show MatchResult;

extension GameInputBridge on VoidstrikeGame {
  /// Widget-space point -> world-space point (screen ray onto the street).
  ui.Offset screenToWorldPoint(ui.Offset local) => screenToWorld(local);

  void aimFromScreen(ui.Offset local) {
    final w = screenToWorld(local);
    aimFromWorld(w.dx, w.dy);
  }
}
