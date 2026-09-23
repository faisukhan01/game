/// Input + HUD support widgets: a self-contained virtual stick with knob
/// feedback, and a lightweight HUD polled at 10 Hz (never at frame rate).
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../game/protocol.dart' show VsColors, VsPlayer;
import '../game/voidstrike_game.dart';

export '../game/voidstrike_game.dart' show MatchResult;

/// Virtual thumbstick: pan anywhere on it, knob tracks the deflection,
/// onMove delivers a normal vector (length ≤ 1), zero on release.
class VirtualStick extends StatefulWidget {
  const VirtualStick({
    super.key,
    required this.label,
    required this.color,
    required this.onMove,
  });

  final String label;
  final Color color;
  final void Function(double x, double y) onMove;

  @override
  State<VirtualStick> createState() => _VirtualStickState();
}

class _VirtualStickState extends State<VirtualStick> {
  static const double _radius = 46;
  Offset _deflection = Offset.zero;
  bool _active = false;
  Offset? _origin;

  void _reset() {
    if (!mounted) return;
    setState(() {
      _active = false;
      _origin = null;
      _deflection = Offset.zero;
    });
    widget.onMove(0, 0);
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onPanStart: (d) => setState(() {
        _active = true;
        _origin = d.localPosition;
      }),
      onPanUpdate: (d) {
        if (_origin == null) return;
        var v = d.localPosition - _origin!;
        final l = v.distance;
        if (l > _radius) v = v / l * _radius;
        setState(() => _deflection = v);
        widget.onMove(v.dx / _radius, v.dy / _radius);
      },
      onPanEnd: (_) => _reset(),
      onPanCancel: _reset,
      child: Opacity(
        opacity: _active ? 1.0 : 0.62,
        child: Container(
          width: 120,
          height: 120,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: widget.color.withValues(alpha: 0.45), width: 1.5),
            color: Colors.white.withValues(alpha: 0.05),
          ),
          child: Stack(
            alignment: Alignment.center,
            children: [
              Text(
                widget.label,
                style: TextStyle(
                  fontSize: 9,
                  letterSpacing: 2,
                  color: widget.color.withValues(alpha: 0.75),
                  fontWeight: FontWeight.w700,
                ),
              ),
              Transform.translate(
                offset: _deflection,
                child: Container(
                  width: 46,
                  height: 46,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: widget.color, width: 1.5),
                    color: widget.color.withValues(alpha: 0.22),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Press-and-hold action button (fires on pointer down for zero lag).
class ActionButton extends StatelessWidget {
  const ActionButton({
    super.key,
    required this.label,
    required this.color,
    required this.onPress,
    this.onRelease,
    this.size = 58,
  });

  final String label;
  final Color color;
  final VoidCallback onPress;
  final VoidCallback? onRelease;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Listener(
      behavior: HitTestBehavior.opaque,
      onPointerDown: (_) => onPress(),
      onPointerUp: (_) => onRelease?.call(),
      onPointerCancel: (_) => onRelease?.call(),
      child: Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(color: color, width: 1.5),
          color: Colors.black.withValues(alpha: 0.55),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: color,
            fontSize: size > 64 ? 13 : 10,
            letterSpacing: 1.5,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

/// HUD overlay: integrity + energy + dash, score / wave / kills. Polled at
/// 10 Hz with setState — cheap, and keeps React-style purity out of Flame.
class HudOverlay extends StatefulWidget {
  const HudOverlay({super.key, required this.game, required this.callsign});

  final VoidstrikeGame game;
  final String callsign;

  @override
  State<HudOverlay> createState() => _HudOverlayState();
}

class _HudOverlayState extends State<HudOverlay> {
  Timer? _timer;
  int _hp = 100, _maxHp = 100;
  int _energy = 100;
  int _score = 0, _wave = 1, _kills = 0;
  double _dashFrac = 0;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(milliseconds: 100), (_) => _pull());
  }

  void _pull() {
    if (!mounted || !widget.game.isLoaded) return;
    final p = widget.game.player;
    setState(() {
      _hp = p.hp.clamp(0, p.maxHp).round();
      _maxHp = p.maxHp.round();
      _energy = p.energy.clamp(0, 100).round();
      _score = widget.game.score;
      _wave = widget.game.wave;
      _kills = widget.game.kills;
      _dashFrac =
          (p.dashCd / VsPlayer.dashCooldown).clamp(0.0, 1.0).toDouble();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Left: bars.
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _bar('INTEGRITY', _hp / _maxHp,
                            _hp < 30 ? const Color(0xFFFF3D5A) : const Color(VsColors.volt)),
                        const SizedBox(height: 4),
                        _bar('ENERGY', _energy / 100, const Color(VsColors.volt)),
                        const SizedBox(height: 4),
                        _bar('DASH', 1 - _dashFrac, const Color(0xFF29E086)),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  // Right: score stack.
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        _score.toString().padLeft(7, '0'),
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          color: Color(VsColors.ink),
                        ),
                      ),
                      Text(
                        'WAVE ${_wave.toString().padLeft(2, '0')} · $_kills KILLS',
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 10,
                          letterSpacing: 1.5,
                          color: Color(VsColors.muted),
                        ),
                      ),
                      Text(
                        '${widget.callsign} // ONSLAUGHT',
                        style: TextStyle(
                          fontSize: 9,
                          letterSpacing: 1.5,
                          color: const Color(VsColors.muted).withValues(alpha: 0.7),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _bar(String label, double frac, Color color) {
    return SizedBox(
      width: 150,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
                fontSize: 8, letterSpacing: 2, color: Color(VsColors.muted)),
          ),
          const SizedBox(height: 2),
          ClipRect(
            child: LinearProgressIndicator(
              value: frac.clamp(0.0, 1.0),
              minHeight: 4,
              backgroundColor: Colors.white.withValues(alpha: 0.10),
              valueColor: AlwaysStoppedAnimation<Color>(color),
            ),
          ),
        ],
      ),
    );
  }
}
