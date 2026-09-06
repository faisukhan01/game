import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'game/voidstrike_game.dart';
import 'widgets/hud.dart';

void main() {
  runApp(const ProviderScope(child: VoidstrikeApp()));
}

class VoidstrikeApp extends StatelessWidget {
  const VoidstrikeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'VOIDSTRIKE',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(VsColors.void_),
        colorScheme: const ColorScheme.dark(
          primary: Color(VsColors.volt),
          secondary: Color(VsColors.flare),
          surface: Color(VsColors.panel),
        ),
      ),
      home: const HomeScreen(),
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _callsign = TextEditingController();
  MatchResult? _lastResult;

  void _deploy() {
    Navigator.of(context).push(
      PageRouteBuilder(
        opaque: false,
        pageBuilder: (_, __, ___) => MatchScreen(
          callsign: _callsign.text.trim().toUpperCase(),
          onResult: (r) => setState(() => _lastResult = r),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 32),
              const Text(
                'VOIDSTRIKE',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 42,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 6,
                  color: Color(VsColors.volt),
                ),
              ),
              const Text(
                'ARENA PROTOCOL · DROP IN. LOCK ON. LEAVE NOTHING.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 11, letterSpacing: 2, color: Color(VsColors.muted)),
              ),
              const Spacer(),
              if (_lastResult != null)
                Text(
                  'LAST RUN — SCORE ${_lastResult!.score} · WAVE ${_lastResult!.wave} · ${_lastResult!.kills} KILLS',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontFamily: 'monospace', color: Color(VsColors.amber)),
                ),
              const SizedBox(height: 24),
              TextField(
                controller: _callsign,
                maxLength: 16,
                textAlign: TextAlign.center,
                style: const TextStyle(letterSpacing: 3, color: Color(VsColors.ink)),
                decoration: InputDecoration(
                  hintText: 'CALLSIGN',
                  counterText: '',
                  filled: true,
                  fillColor: const Color(VsColors.panel),
                  border: OutlineInputBorder(borderSide: BorderSide.none),
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                height: 56,
                child: FilledButton(
                  onPressed: _deploy,
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(VsColors.volt),
                    foregroundColor: const Color(VsColors.void_),
                    shape: const RoundedRectangleBorder(),
                  ),
                  child: const Text('DEPLOY TO ARENA',
                      style: TextStyle(fontWeight: FontWeight.w700, letterSpacing: 2)),
                ),
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }
}
