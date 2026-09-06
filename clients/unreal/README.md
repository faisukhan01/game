# VOIDSTRIKE Unreal Module (UE5 C++)

`VoidstrikeArena` — engine plugin-style module with the Protocol v1
deterministic simulation as an **Engine subsystem** (`UArenaSimulationSubsystem`).

## Build (UBT)

```bash
# generate project files, then:
UnrealBuildTool -mode=Build -target=VoidstrikeArenaEditor Win64 Development
```

CI: `.github/workflows/unreal-build.yml` runs UBT inside an Epic-aligned
runner image on tags; requires Epic credentials as repo secrets.

## Design notes

- `UArenaSimulationSubsystem` is a `UTickableWorldSubsystem` with a fixed-step
  accumulator — the game thread never integrates with variable dt.
- Snapshot struct (`FVsSnapshot`) is the replication source; `FNv1a64` +
  `Quantize` are byte-exact with the C core, so replay validation ports
  directly (golden vectors under `testdata/golden/`).
- `FSplitMix64` is the only RNG in the deterministic path.
