# VOIDSTRIKE Unity Client (PC / Console)

Unity 2022.3 LTS client sharing the deterministic C# core
(`Packages/com.voidstrike.core` — mirror of `core/c`, golden-vector tested).

## Layout

```
Assets/Voidstrike/Scripts/Runtime/   MatchBootstrap, ArenaSimulation, InputController,
                                     NetworkTransport (WS facade), EntityViewRoot
Assets/Voidstrike/Scripts/Editor/    SceneSetup — builds Arena.unity programmatically
Packages/com.voidstrike.core/        local package: Protocol.cs (constants, FNV, splitmix64)
```

## First run

1. Open the project in Unity 2022.3 LTS (GameCI does this headlessly in CI).
2. `Voidstrike → Build Arena Scene` — generates the scene from code (no
   binary scene files in git).
3. Press Play: offline Onslaught vs FSM bots. Enable `connectOnline` on the
   bootstrap to route through `NetworkTransport` to the Go server.

## CI

`.github/workflows/unity-build.yml` (GameCI) runs edit-mode tests and builds
Windows/Android targets; requires `UNITY_LICENSE`, `UNITY_EMAIL`,
`UNITY_PASSWORD`, `UNITY_TOTP` secrets on the repo.
