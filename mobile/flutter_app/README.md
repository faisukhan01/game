# VOIDSTRIKE Mobile (Flutter + Flame)

Cross-platform Onslaught client: fixed 60Hz sim mirroring Protocol v1,
procedurally-drawn soldier operatives (armor, helmet, visor, two-handed
rifle rig with walk cycle + muzzle flashes), twin-stick touch controls, and
an online Versus transport to the Go gameserver.

## Download the APK

Rolling signed release APK (rebuilt on every green `main` push):

**https://github.com/faisukhan01/game/releases/tag/apk-latest**

Versioned APKs ride on `v*` tag releases. Min Android 7.0 (API 24), universal ABI.

## Build (CI or local)

```bash
flutter pub get
flutter analyze        # CI gate
flutter test           # protocol constants + sim tests
flutter build apk --release
```

The `android/` platform folder is committed (Gradle KTS, AGP 8.9, namespace
`gg.voidstrike.game`, release builds signed with the debug key so the APK
sideloads anywhere). CI: `.github/workflows/android-apk.yml`.

## Layout

- `lib/game/protocol.dart` — Protocol v1 constants (synced with core/c)
- `lib/game/soldier.dart` — procedural soldier rig + muzzle flash painter
- `lib/game/voidstrike_game.dart` — Flame game: fixed-step ticks, bot FSM,
  waves, nova/dash, collisions, facing/gait animation, fixed-resolution
  letterbox viewport
- `lib/widgets/` — HUD, twin-stick touch controls, match flow
