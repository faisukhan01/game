// VOIDSTRIKE — Protocol v1 constants (Unreal C++ port).
// Mirrors core/c/include/voidstrike/types.h exactly.
#pragma once

#include "CoreMinimal.h"

namespace Voidstrike
{
	constexpr double WorldW = 1600.0;
	constexpr double WorldH = 900.0;
	constexpr double Dt = 0.016666666666666666; // literal 1/60 — never recompute

	constexpr double PlayerRadius = 14.0;
	constexpr double PlayerMaxHp = 100.0;
	constexpr double PlayerSpeed = 260.0;
	constexpr double EnergyMax = 100.0;
	constexpr double EnergyRegen = 14.0;
	constexpr double DashCooldown = 3.0;
	constexpr double DashImpulse = 720.0;

	constexpr double RifleInterval = 0.1;
	constexpr double RifleSpeed = 560.0;
	constexpr double RifleDamage = 10.0;
	constexpr double RifleSpreadDeg = 2.0;
	constexpr double RifleLifetime = 1.2;
	constexpr double RifleEnergy = 2.0;

	constexpr double NovaEnergy = 55.0;
	constexpr double NovaRadius = 210.0;
	constexpr double NovaDamage = 48.0;
	constexpr double NovaKnockback = 420.0;

	// Canonical cross-language quantization: floor(v*1000 + 0.5).
	inline int64 Quantize(double V)
	{
		return static_cast<int64>(FMath::Floor(V * 1000.0 + 0.5));
	}

	// FNV-1a 64 — byte-exact with the C core.
	inline uint64 Fnv1a64(const uint8* Data, int64 Len)
	{
		uint64 H = 0xcbf29ce484222325ULL;
		for (int64 i = 0; i < Len; ++i)
		{
			H ^= Data[i];
			H *= 0x100000001b3ULL;
		}
		return H;
	}

	inline uint64 RulesHash()
	{
		return Fnv1a64(reinterpret_cast<const uint8*>("VOIDSTRIKE_SIM_V1"), 17);
	}

	/** splitmix64 — deterministic RNG (PROTOCOL §4). */
	struct FSplitMix64
	{
		uint64 State;

		explicit FSplitMix64(uint64 Seed) : State(Seed) {}

		uint64 Next()
		{
			State += 0x9E3779B97F4A7C15ULL;
			uint64 Z = State;
			Z = (Z ^ (Z >> 30)) * 0xBF58476D1CE4E5B9ULL;
			Z = (Z ^ (Z >> 27)) * 0x94D049BB133111EBULL;
			return Z ^ (Z >> 27);
		}

		double Uniform01() { return static_cast<double>(Next()) / 18446744073709551616.0; }
	};
}
