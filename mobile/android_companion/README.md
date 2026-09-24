# VOIDSTRIKE Companion (Kotlin + Jetpack Compose)

Season ladder, player stats and push alerts on the go. Talks to the Java
live-ops service (`services/leaderboard`) over Retrofit + kotlinx-serialization.

## Build (CI or local with Android SDK)

```bash
./gradlew :app:assembleDebug     # CI builds this on every PR
```

- Kotlin 2.0.21 · Compose BOM 2024.10 · Material3 · minSdk 26
- Brand palette mirrored from `docs/BRAND.md` (`ui/VsColors`)
