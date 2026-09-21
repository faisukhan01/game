import 'package:flutter/material.dart';
import 'package:flame/game.dart';

import '../game/protocol.dart' show VsColors;
import '../game/voidstrike_game.dart';
import 'hud.dart' show ActionButton, HudOverlay, VirtualStick;
import 'protocol_shim.dart';

/// Match screen: side-view game canvas with a follow camera + twin-stick
/// touch controls (left = move, right = aim) + FIRE / DASH / NOVA buttons.
class MatchScreen extends StatelessWidget {
  MatchScreen({super.key, required this.callsign, required this.onResult});

  final String callsign;
  final ValueChanged<MatchResult> onResult;

  @override
  Widget build(BuildContext context) {
    final game = VoidstrikeGame(onMatchOver: (r) {
      onResult(r);
      if (context.mounted) Navigator.of(context).pop();
    });
    final pad = MediaQuery.paddingOf(context);
    const volt = Color(VsColors.volt);
    const flare = Color(VsColors.flare);
    const mint = Color(0xFF29E086);

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          // Game canvas (desktop hover aim still works via mouse).
          Positioned.fill(
            child: MouseRegion(
              onHover: (e) {
                game.aimFromScreen(e.localPosition, MediaQuery.sizeOf(context));
                game.noteManualAim();
              },
              child: GameWidget(game: game),
            ),
          ),
          // HUD.
          HudOverlay(game: game, callsign: callsign),
          // Move stick — bottom left.
          Positioned(
            left: 16 + pad.left,
            bottom: 16 + pad.bottom,
            child: VirtualStick(
              label: 'MOVE',
              color: volt,
              onMove: (x, y) {
                game.moveX = x;
                game.moveY = y;
              },
            ),
          ),
          // Aim stick — bottom right, inboard of the action buttons.
          Positioned(
            right: 96 + pad.right,
            bottom: 16 + pad.bottom,
            child: VirtualStick(
              label: 'AIM',
              color: flare,
              onMove: (x, y) {
                if (x != 0 || y != 0) {
                  game.aimX = x;
                  game.aimY = y;
                  game.noteManualAim();
                }
              },
            ),
          ),
          // Action buttons — bottom right edge.
          Positioned(
            right: 16 + pad.right,
            bottom: 16 + pad.bottom,
            child: Column(
              children: [
                ActionButton(
                  label: 'NOVA',
                  color: volt,
                  size: 52,
                  onPress: () => game.novaQueued = true,
                ),
                const SizedBox(height: 10),
                ActionButton(
                  label: 'DASH',
                  color: mint,
                  size: 52,
                  onPress: () => game.dashQueued = true,
                ),
                const SizedBox(height: 10),
                ActionButton(
                  label: 'FIRE',
                  color: flare,
                  size: 72,
                  onPress: () => game.firing = true,
                  onRelease: () => game.firing = false,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
