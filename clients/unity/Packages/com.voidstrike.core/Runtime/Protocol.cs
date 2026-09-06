// VOIDSTRIKE Core — Protocol v1 deterministic simulation (C# port).
// Mirrors core/c/src/world.c; conformance via testdata/golden/ticks.json.
using System;

namespace Voidstrike.Core
{
    public static class Protocol
    {
        public const double WorldW = 1600.0, WorldH = 900.0;
        public const double Dt = 0.016666666666666666; // literal 1/60

        public const double PlayerRadius = 14.0, PlayerMaxHp = 100.0, PlayerSpeed = 260.0;
        public const double EnergyMax = 100.0, EnergyRegen = 14.0;
        public const double DashCooldown = 3.0, DashImpulse = 720.0;

        public const double RifleInterval = 0.1, RifleSpeed = 560.0, RifleDamage = 10.0;
        public const double RifleSpreadDeg = 2.0, RifleLifetime = 1.2, RifleEnergy = 2.0;
        public const double NovaEnergy = 55.0, NovaRadius = 210.0, NovaDamage = 48.0, NovaKnockback = 420.0;

        public const string RulesSeed = "VOIDSTRIKE_SIM_V1";

        public static readonly double[,] Obstacles =
        {
            { 200, 150, 220, 40 }, { 1180, 150, 220, 40 }, { 200, 710, 220, 40 },
            { 700, 420, 200, 60 }, { 1180, 710, 220, 40 }
        };

        // FNV-1a 64 — byte-exact with the C core.
        public static ulong Fnv1a64(byte[] data)
        {
            ulong h = 0xcbf29ce484222325;
            foreach (byte b in data)
            {
                h ^= b;
                h *= 0x100000001b3;
            }
            return h;
        }

        public static ulong RulesHash() => Fnv1a64(System.Text.Encoding.UTF8.GetBytes(RulesSeed));

        // Canonical quantization: floor(v*1000 + 0.5) — never Math.Round.
        public static long Quantize(double v) => (long)Math.Floor(v * 1000.0 + 0.5);
    }

    /// splitmix64 — the only RNG permitted in the deterministic path.
    public struct SplitMix64
    {
        private ulong _state;
        public SplitMix64(ulong seed) => _state = seed;

        public ulong Next()
        {
            _state += 0x9E3779B97F4A7C15UL;
            ulong z = _state;
            z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
            z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
            return z ^ (z >> 27);
        }

        public double Uniform01() => Next() / 18446744073709551616.0;
    }
}
