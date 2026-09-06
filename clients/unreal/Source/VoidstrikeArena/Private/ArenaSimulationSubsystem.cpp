// VOIDSTRIKE — ArenaSimulationSubsystem implementation (Protocol v1 port).
#include "ArenaSimulationSubsystem.h"

namespace
{
	// Static obstacles + spawn points (PROTOCOL §2) — kept literal for determinism.
	constexpr int32 NumObstacles = 5;
	const double Obstacles[NumObstacles][4] = {
		{ 200, 150, 220, 40 }, { 1180, 150, 220, 40 }, { 200, 710, 220, 40 },
		{ 700, 420, 200, 60 }, { 1180, 710, 220, 40 }
	};

	const double SpawnPoints[8][2] = {
		{ 80, 80 }, { 1520, 80 }, { 80, 820 }, { 1520, 820 },
		{ 800, 40 }, { 800, 860 }, { 40, 450 }, { 1560, 450 }
	};

	bool SegVsBox(double X1, double Y1, double X2, double Y2, const double B[4])
	{
		double Tmin = 0.0, Tmax = 1.0;
		const double Dx = X2 - X1, Dy = Y2 - Y1;
		if (FMath::Abs(Dx) < 1e-12)
		{
			if (X1 < B[0] || X1 > B[0] + B[2]) return false;
		}
		else
		{
			double T1 = (B[0] - X1) / Dx, T2 = (B[0] + B[2] - X1) / Dx;
			if (T1 > T2) Swap(T1, T2);
			Tmin = FMath::Max(Tmin, T1);
			Tmax = FMath::Min(Tmax, T2);
			if (Tmin > Tmax) return false;
		}
		if (FMath::Abs(Dy) < 1e-12)
		{
			if (Y1 < B[1] || Y1 > B[1] + B[3]) return false;
		}
		else
		{
			double T1 = (B[1] - Y1) / Dy, T2 = (B[1] + B[3] - Y1) / Dy;
			if (T1 > T2) Swap(T1, T2);
			Tmin = FMath::Max(Tmin, T1);
			Tmax = FMath::Min(Tmax, T2);
			if (Tmin > Tmax) return false;
		}
		return true;
	}

	bool Los(double X1, double Y1, double X2, double Y2)
	{
		for (int32 i = 0; i < NumObstacles; ++i)
		{
			if (SegVsBox(X1, Y1, X2, Y2, Obstacles[i])) return false;
		}
		return true;
	}
}

void UArenaSimulationSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
}

void UArenaSimulationSubsystem::Deinitialize()
{
	Super::Deinitialize();
}

void UArenaSimulationSubsystem::StartMatch(uint64 Seed)
{
	Rng = FSplitMix64(Seed);
	Units.Reset();
	Projectiles.Reset();
	ProjectileVel.Reset();

	FVsFighter Player;
	Player.Id = 0;
	Player.X = 800.0;
	Player.Y = 300.0;
	Player.Hp = Player.MaxHp = Voidstrike::PlayerMaxHp;
	Player.Speed = Voidstrike::PlayerSpeed;
	Player.Radius = Voidstrike::PlayerRadius;
	Units.Add(Player);

	Score = 0;
	Wave = 1;
	Combo = 1;
	WavePending = 3 + 2 * Wave;
	SpawnTimer = 0.4;
	SpawnIdx = 0;
	Elapsed = 0.0;
	Acc = 0.0;
	bMatchOver = false;
}

void UArenaSimulationSubsystem::SetPlayerInput(double MoveX, double MoveY, double AimX, double AimY, bool bFire, bool bDash, bool bNova)
{
	Input.Mx = MoveX;
	Input.My = MoveY;
	Input.Ax = AimX;
	Input.Ay = AimY;
	Input.bFire = bFire;
	Input.bDash = bDash;
	Input.bNova = bNova;
}

void UArenaSimulationSubsystem::Tick(float DeltaTime)
{
	if (bMatchOver || Units.Num() == 0) return;

	// Fixed-step accumulator — sim advances exactly at Protocol rate.
	Acc += DeltaTime;
	int32 Steps = 0;
	while (Acc >= Voidstrike::Dt && Steps < 5)
	{
		Step();
		Acc -= Voidstrike::Dt;
		++Steps;
	}
	if (Steps >= 5) Acc = 0.0;

	// Publish snapshot (UI + replication source).
	LastSnapshot.Tick = static_cast<uint32>(Elapsed * 60.0);
	LastSnapshot.Score = Score;
	LastSnapshot.Wave = Wave;
	LastSnapshot.Units = Units;
}

void UArenaSimulationSubsystem::Step()
{
	Elapsed += Voidstrike::Dt;

	FVsFighter& Player = Units[0];

	if (Combo > 1 && (ComboTimer -= Voidstrike::Dt) <= 0) Combo = 1;
	for (FVsFighter& U : Units)
	{
		if (U.FireCd > 0) U.FireCd -= Voidstrike::Dt;
	}

	// --- player ---
	if (Player.bAlive)
	{
		const double L = FMath::Sqrt(Input.Mx * Input.Mx + Input.My * Input.My);
		const double Tx = L > 0 ? Input.Mx / L * Player.Speed : 0.0;
		const double Ty = L > 0 ? Input.My / L * Player.Speed : 0.0;
		Player.Vx += (Tx - Player.Vx) * 0.2;
		Player.Vy += (Ty - Player.Vy) * 0.2;

		if (Input.bDash && Player.DashCd <= 0)
		{
			Player.DashCd = Voidstrike::DashCooldown;
			const bool bHasMove = FMath::Abs(Input.Mx) + FMath::Abs(Input.My) > 1e-6;
			Player.Vx += (bHasMove ? Input.Mx : Input.Ax) * Voidstrike::DashImpulse;
			Player.Vy += (bHasMove ? Input.My : Input.Ay) * Voidstrike::DashImpulse;
		}
		Player.X += Player.Vx * Voidstrike::Dt;
		Player.Y += Player.Vy * Voidstrike::Dt;

		if (Input.bFire && Player.FireCd <= 0 && Player.Energy >= Voidstrike::RifleEnergy)
		{
			const double Spread = (Rng.Uniform01() * 2.0 - 1.0) * Voidstrike::RifleSpreadDeg * PI / 180.0;
			const double C = FMath::Cos(Spread), S = FMath::Sin(Spread);
			const double Rx = Input.Ax * C - Input.Ay * S, Ry = Input.Ax * S + Input.Ay * C;
			Projectiles.Add(FVector2D(Player.X + Rx * 20.0, Player.Y + Ry * 20.0));
			ProjectileVel.Add(FVector2D(Rx * Voidstrike::RifleSpeed, Ry * Voidstrike::RifleSpeed));
			Player.Energy -= Voidstrike::RifleEnergy;
			Player.FireCd = Voidstrike::RifleInterval;
		}
		if (Input.bNova && Player.Energy >= Voidstrike::NovaEnergy)
		{
			Player.Energy -= Voidstrike::NovaEnergy;
			for (FVsFighter& B : Units)
			{
				if (B.Id == 0 || !B.bAlive) continue;
				const double Dx = B.X - Player.X, Dy = B.Y - Player.Y;
				const double D = FMath::Sqrt(Dx * Dx + Dy * Dy);
				if (D <= Voidstrike::NovaRadius)
				{
					B.Hp -= Voidstrike::NovaDamage;
					B.Vx += Dx / FMath::Max(D, 1.0) * Voidstrike::NovaKnockback;
					B.Vy += Dy / FMath::Max(D, 1.0) * Voidstrike::NovaKnockback;
				}
			}
		}
		Player.Energy = FMath::Min(Voidstrike::EnergyMax, Player.Energy + Voidstrike::EnergyRegen * Voidstrike::Dt);
	}

	// --- bots ---
	for (int32 i = 1; i < Units.Num(); ++i)
	{
		FVsFighter& B = Units[i];
		if (!B.bAlive) continue;
		B.StateTimer -= Voidstrike::Dt;
		const double Pdx = Player.X - B.X, Pdy = Player.Y - B.Y;
		const double Dist = FMath::Sqrt(Pdx * Pdx + Pdy * Pdy);

		if (B.StateTimer <= 0)
		{
			B.StateTimer = 0.25;
			B.State =
				B.Hp < 0.25 * B.MaxHp ? EVsBotState::Flee :
				(Dist < 420.0 && Los(B.X, B.Y, Player.X, Player.Y)) ? EVsBotState::Attack :
				Dist < 260.0 ? EVsBotState::Strafe :
				Dist < 520.0 ? EVsBotState::Chase : EVsBotState::Patrol;
			if (B.State == EVsBotState::Strafe || B.State == EVsBotState::Attack)
			{
				B.OrbitSign = Rng.Uniform01() < 0.5 ? -1 : 1;
			}
		}

		double Mx = 0, My = 0;
		switch (B.State)
		{
		case EVsBotState::Patrol:
			B.WaypointTimer -= Voidstrike::Dt;
			if (B.WaypointTimer <= 0 ||
				FMath::Square(B.Wpx - B.X) + FMath::Square(B.Wpy - B.Y) < 400.0)
			{
				B.Wpx = Rng.Uniform01() * Voidstrike::WorldW;
				B.Wpy = Rng.Uniform01() * Voidstrike::WorldH;
				B.WaypointTimer = 4.0;
			}
			Mx = B.Wpx - B.X; My = B.Wpy - B.Y;
			break;
		case EVsBotState::Chase: Mx = Pdx; My = Pdy; break;
		case EVsBotState::Strafe:
		case EVsBotState::Attack: Mx = -Pdy * B.OrbitSign; My = Pdx * B.OrbitSign; break;
		case EVsBotState::Flee: Mx = -Pdx; My = -Pdy; break;
		}

		const double ML = FMath::Sqrt(Mx * Mx + My * My);
		const double Mul = (B.State == EVsBotState::Strafe || B.State == EVsBotState::Attack) ? 0.6 : 1.0;
		const double Tx = ML > 0 ? Mx / ML * B.Speed * Mul : 0.0;
		const double Ty = ML > 0 ? My / ML * B.Speed * Mul : 0.0;
		B.Vx += (Tx - B.Vx) * 0.2;
		B.Vy += (Ty - B.Vy) * 0.2;
		B.X += B.Vx * Voidstrike::Dt;
		B.Y += B.Vy * Voidstrike::Dt;

		if (B.State == EVsBotState::Attack && B.FireCd <= 0 && Dist < 420.0 &&
			Los(B.X, B.Y, Player.X, Player.Y) && Player.bAlive)
		{
			const double Jitter = (Rng.Uniform01() * 2.0 - 1.0) *
				FMath::Max(3.0, 12.0 - 0.5 * B.Wave) * PI / 180.0;
			const double Ax = Pdx / FMath::Max(Dist, 1.0), Ay = Pdy / FMath::Max(Dist, 1.0);
			const double C = FMath::Cos(Jitter), S = FMath::Sin(Jitter);
			Projectiles.Add(FVector2D(B.X + (Ax * C - Ay * S) * 20.0, B.Y + (Ax * S + Ay * C) * 20.0));
			ProjectileVel.Add(FVector2D((Ax * C - Ay * S) * 480.0, (Ax * S + Ay * C) * 480.0));
			B.FireCd = 0.85;
		}
	}

	// --- resolve bounds/obstacles (simplified push-out) ---
	for (FVsFighter& U : Units)
	{
		if (!U.bAlive) continue;
		U.X = FMath::Clamp(U.X, U.Radius, Voidstrike::WorldW - U.Radius);
		U.Y = FMath::Clamp(U.Y, U.Radius, Voidstrike::WorldH - U.Radius);
	}

	// --- projectiles ---
	for (int32 i = Projectiles.Num() - 1; i >= 0; --i)
	{
		FVector2D& P = Projectiles[i];
		const FVector2D V = ProjectileVel[i];
		P.X += V.X * Voidstrike::Dt;
		P.Y += V.Y * Voidstrike::Dt;

		bool bDead = false;
		for (FVsFighter& U : Units)
		{
			if (!U.bAlive) continue;
			const double Dx = P.X - U.X, Dy = P.Y - U.Y;
			const double RR = U.Radius + 4.0;
			if (Dx * Dx + Dy * Dy < RR * RR)
			{
				U.Hp -= 10.0; // unified damage for the C++ demo path
				bDead = true;
				break;
			}
		}
		if (bDead)
		{
			Projectiles.RemoveAtSwap(i);
			ProjectileVel.RemoveAtSwap(i);
		}
	}

	// --- deaths / waves ---
	for (FVsFighter& U : Units)
	{
		if (U.bAlive && U.Hp <= 0 && U.Id != 0)
		{
			U.bAlive = false;
			Score += 100 * Combo;
			Combo = FMath::Min(Combo + 1, 5);
			ComboTimer = 3.0;
		}
	}

	bool bAllDead = true;
	for (const FVsFighter& U : Units)
	{
		if (U.Id != 0 && U.bAlive) { bAllDead = false; break; }
	}
	if (WavePending == 0 && bAllDead)
	{
		Score += 250 + 50 * Wave;
		++Wave;
		WavePending = 3 + 2 * Wave;
		SpawnTimer = 0.4;
	}
	if (WavePending > 0 && (SpawnTimer -= Voidstrike::Dt) <= 0)
	{
		SpawnBot();
		--WavePending;
		SpawnTimer = 0.4;
	}
}

void UArenaSimulationSubsystem::SpawnBot()
{
	const double* Pt = SpawnPoints[SpawnIdx % 8];
	++SpawnIdx;

	FVsFighter B;
	B.Id = Units.Num();
	B.X = Pt[0];
	B.Y = Pt[1];
	B.MaxHp = FMath::Min(30.0 + 8.0 * Wave, 90.0);
	B.Hp = B.MaxHp;
	B.Speed = FMath::Min(150.0 + 6.0 * Wave, 240.0);
	B.Wave = Wave;
	B.StateTimer = 0.25 * (B.Id % 16) / 16.0;
	Units.Add(B);
}
