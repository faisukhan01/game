# VOIDSTRIKE Mobile (Flutter + Flame)

Cross-platform Onslaught client: fixed 60Hz sim mirroring Protocol v1,
twin-stick touch controls, online Versus transport to the Go gameserver.

## Build (CI or local)

```bash
flutter pub get
flutter analyze        # CI gate
flutter test           # protocol constants + sim tests
flutter build apk --debug
flutter build web      # optional
```

- `lib/game/protocol.dart` — Protocol v1 constants (synced with core/c)
- `lib/game/voidstrike_game.dart` — Flame game: fixed-step ticks, bot FSM,
  waves, nova/dash, collisions
- `lib/widgets/` — HUD, twin-stick touch controls, match flow
