/// Input + HUD support types shared by the widgets layer.
library;

import 'package:flutter/material.dart';

import '../game/voidstrike_game.dart';

export '../game/voidstrike_game.dart' show MatchResult;

/// Twin-stick input state. Move is a normal vector; aim converts screen
/// coordinates into Protocol world coordinates.
class StickState {
  Offset origin = Offset.zero;
  bool aiming = false;

  void startAim(Offset local, Size screen) {
    origin = local;
    aiming = true;
  }

  void updateAim(Offset local, VoidstrikeGame game) {
    if (!aiming) return;
    final scale = game.canvasScaleFor(screen);
    final wx = local.dx / scale;
    final wy = local.dy / scale;
    game.aimFromWorld(wx, wy);
  }

  void endAim() => aiming = false;
}

class VirtualStick extends StatelessWidget {
  const VirtualStick({super.key, required this.state, required this.onMove});

  final StickState state;
  final void Function(double x, double y) onMove;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onPanStart: (d) => state.origin = d.localPosition,
      onPanUpdate: (d) {
        final dx = d.localPosition - state.origin;
        final l = dx.distance;
        if (l > 1) onMove(dx.dx / l, dx.dy / l);
      },
      onPanEnd: (_) => onMove(0, 0),
      child: Container(
        width: 112,
        height: 112,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(color: const Color(0x59C8F31D)),
          color: Colors.white10,
        ),
        child: Center(
          child: Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: const Color(0x80C8F31D)),
              color: const Color(0x33C8F31D),
            ),
          ),
        ),
      ),
    );
  }

}

class HudOverlay extends StatelessWidget {
  const HudOverlay({super.key, required this.game, required this.callsign});

  final VoidstrikeGame game;
  final String callsign;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('$callsign // ONSLAUGHT',
                      style: const TextStyle(
                          fontSize: 10, letterSpacing: 2, color: Color(VsColors.muted))),
                  Text(
                    'PROTOCOL v1 · 60 HZ',
                    style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 12,
                        color: Color(VsColors.ink)),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
