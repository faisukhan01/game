import 'package:flutter/material.dart';
import 'package:flame/game.dart';

import '../game/protocol.dart' show VsColors;
import '../game/voidstrike_game.dart';
import 'hud.dart' show ActionButton, HudOverlay, VirtualStick;
import 'protocol_shim.dart';

/// Match screen: GTA-style third-person game canvas with drag-look,
/// a move stick (camera-relative) and FIRE / DASH / NOVA buttons. Aiming
/// is where the camera looks, with a soft snap onto visible hostiles.
class MatchScreen extends StatelessWidget {
  const MatchScreen({super.key, required this.callsign, required this.onResult});

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
          // Game canvas: drag anywhere to look (mouse hover aims on desktop).
          Positioned.fill(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onPanUpdate: (d) => game.rotateLook(d.delta.dx),
              child: MouseRegion(
                onHover: (e) {
                  game.aimFromScreen(e.localPosition);
                  game.noteManualAim();
                },
                child: GameWidget(game: game),
              ),
            ),
          ),
          // HUD.
          HudOverlay(game: game, callsign: callsign),
          // Move stick — bottom left (camera-relative).
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
