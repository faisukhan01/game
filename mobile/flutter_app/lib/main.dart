import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'game/protocol.dart' show VsColors;
import 'widgets/match_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // Arena shooters read best in landscape — the follow camera fills the
  // long edge and the twin sticks land in the thumb zones.
  SystemChrome.setPreferredOrientations([
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);
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
    FocusScope.of(context).unfocus();
    Navigator.of(context).push(
      PageRouteBuilder(
        opaque: false,
        pageBuilder: (_, __, ___) => MatchScreen(
          callsign: _callsign.text.trim().isEmpty
              ? 'STRIKER'
              : _callsign.text.trim().toUpperCase(),
          onResult: (r) => setState(() => _lastResult = r),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'VOIDSTRIKE',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 38,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 6,
                      color: Color(VsColors.volt),
                    ),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'ARENA PROTOCOL · DROP IN. LOCK ON. LEAVE NOTHING.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                        fontSize: 10,
                        letterSpacing: 2,
                        color: Color(VsColors.muted)),
                  ),
                  const SizedBox(height: 22),
                  if (_lastResult != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 18),
                      child: Text(
                        'LAST RUN — SCORE ${_lastResult!.score} · WAVE ${_lastResult!.wave} · ${_lastResult!.kills} KILLS',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                            fontFamily: 'monospace',
                            color: Color(VsColors.amber)),
                      ),
                    ),
                  TextField(
                    controller: _callsign,
                    maxLength: 16,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                        letterSpacing: 3, color: Color(VsColors.ink)),
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
                    height: 54,
                    child: FilledButton(
                      onPressed: _deploy,
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(VsColors.volt),
                        foregroundColor: const Color(VsColors.void_),
                        shape: const RoundedRectangleBorder(),
                      ),
                      child: const Text('DEPLOY TO ARENA',
                          style: TextStyle(
                              fontWeight: FontWeight.w700, letterSpacing: 2)),
                    ),
                  ),
                  const SizedBox(height: 10),
                  const Text(
                    'LEFT STICK MOVE · RIGHT STICK AIM · FIRE / DASH / NOVA BUTTONS\nAUTO-AIM ENGAGES WHEN THE AIM STICK IS IDLE',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                        fontSize: 9, height: 1.6, color: Color(VsColors.muted)),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
