// VOIDSTRIKE — ArenaSimulationSubsystem: fixed-step Protocol v1 sim as an
// Engine subsystem. Server-authoritative; clients receive snapshot decoding.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/EngineSubsystem.h"
#include "VoidstrikeProtocol.h"
#include "ArenaSimulationSubsystem.generated.h"

UENUM()
enum class EVsBotState : uint8
{
	Patrol, Chase, Strafe, Attack, Flee
};

USTRUCT()
struct FVsFighter
{
	GENERATED_BODY()

	UPROPERTY()
	int32 Id = 0;

	UPROPERTY()
	bool bAlive = true;

	UPROPERTY()
	double X = 0, Y = 0, Vx = 0, Vy = 0;

	UPROPERTY()
	double Hp = 100, MaxHp = 100, Speed = 260, Radius = 14;

	UPROPERTY()
	double FireCd = 0, Energy = 0, DashCd = 0;

	UPROPERTY()
	EVsBotState State = EVsBotState::Patrol;

	UPROPERTY()
	double StateTimer = 0, WaypointTimer = 0, Wpx = 0, Wpy = 0;

	UPROPERTY()
	int32 OrbitSign = 1, Wave = 1;
};

USTRUCT()
struct FVsSnapshot
{
	GENERATED_BODY()

	UPROPERTY()
	uint32 Tick = 0;

	UPROPERTY()
	int64 Score = 0;

	UPROPERTY()
	int32 Wave = 1;

	UPROPERTY()
	TArray<FVsFighter> Units;

	UPROPERTY()
	TArray<FVector2D> Projectiles;
};

DECLARE_MULTICAST_DELEGATE_OneParam(FOnVsMatchEnd, const FVsSnapshot& /*FinalState*/);

/**
 * Engine subsystem driving the deterministic arena sim at a fixed 60Hz.
 * Tick order mirrors core/c/src/world.c (PROTOCOL §5) — golden vectors must
 * pass (tests under Source/VoidstrikeArena/VoidstrikeArenaTests).
 */
UCLASS()
class VOIDSTRIKEARENA_API UArenaSimulationSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override
	{
		RETURN_QUICK_DECLARE_CYCLE_STAT(UArenaSimulationSubsystem, STATGROUP_Tickables);
	}

	/** Start a fresh Onslaught run with the given seed. */
	void StartMatch(uint64 Seed);

	/** Player control state (last-wins per tick). */
	void SetPlayerInput(double MoveX, double MoveY, double AimX, double AimY, bool bFire, bool bDash, bool bNova);

	const FVsSnapshot& GetLastSnapshot() const { return LastSnapshot; }

	FOnVsMatchEnd OnMatchEnd;

private:
	void Step();
	void SpawnBot();

	FSplitMix64 Rng = FSplitMix64(1337);
	TArray<FVsFighter> Units;
	TArray<FVector2D> Projectiles; // x, y + velocity packed in component form
	TArray<FVector2D> ProjectileVel;

	double Acc = 0.0;
	double Elapsed = 0.0;
	double ComboTimer = 0.0, SpawnTimer = 0.4;
	int32 Score = 0, Wave = 1, Combo = 1, WavePending = 5, SpawnIdx = 0;
	bool bMatchOver = false;

	// last-wins player input
	struct
	{
		double Mx = 0, My = 0, Ax = 1, Ay = 0;
		bool bFire = false, bDash = false, bNova = false;
	} Input;

	FVsSnapshot LastSnapshot;
};
