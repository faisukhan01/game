import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flame/game.dart';

import '../game/voidstrike_game.dart';
import 'hud.dart' show HudOverlay, StickState, VirtualStick;
import 'protocol_shim.dart';

/// Match screen: game canvas + twin-stick touch controls + HUD overlay.
class MatchScreen extends StatelessWidget {
  MatchScreen({super.key, required this.callsign, required this.onResult});

  final String callsign;
  final ValueChanged<MatchResult> onResult;

  final _stick = StickState();

  @override
  Widget build(BuildContext context) {
    final game = VoidstrikeGame(onMatchOver: (r) {
      onResult(r);
      if (context.mounted) Navigator.of(context).pop();
    });

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          // aim layer
          LayoutBuilder(builder: (context, constraints) {
            return GestureDetector(
              onPanStart: (d) => _stick.startAim(d.localPosition, constraints.biggest),
              onPanUpdate: (d) => _stick.updateAim(d.localPosition, game),
              onPanEnd: (_) => _stick.endAim(),
              onPanCancel: _stick.endAim,
              child: MouseRegion(
                onHover: (e) => game.aimFromScreen(e.localPosition, constraints.biggest),
                child: Listener(
                  onPointerDown: (e) {
                    if (e.buttons == kPrimaryMouseButton) game.firing = true;
                  },
                  onPointerUp: (_) => game.firing = false,
                  child: GameWidget(game: game),
                ),
              ),
            );
          }),
          // HUD
          HudOverlay(game: game, callsign: callsign),
          // move stick (left)
          Positioned(
            left: 16,
            bottom: 16,
            child: VirtualStick(
              state: _stick,
              onMove: (x, y) {
                game.moveX = x;
                game.moveY = y;
              },
            ),
          ),
          // action buttons (right)
          Positioned(
            right: 16,
            bottom: 16,
            child: Row(
              children: [
                _ActionButton(label: 'DASH', onTap: () => game.dashQueued = true),
                const SizedBox(width: 10),
                _ActionButton(label: 'NOVA', onTap: () => game.novaQueued = true),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 64,
        height: 64,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          border: Border.all(color: const Color(VsColors.volt), width: 1.5),
          color: Colors.black54,
        ),
        child: Text(label,
            style: const TextStyle(
                color: Color(VsColors.ink), fontSize: 11, letterSpacing: 1.5)),
      ),
    );
  }
}
