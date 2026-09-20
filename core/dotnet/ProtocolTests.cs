// VOIDSTRIKE Core — Protocol v1 conformance tests (C#).
// Vectors cross-checked against an independent bignum implementation and the
// C reference (core/c/tests/test_main.c). The rules_hash assertion is the
// cross-language lock: C, C#, Go, TypeScript, Dart and Python must all agree
// on 0xBFB4742570DAA8FB for seed string "VOIDSTRIKE_SIM_V1".

using Xunit;

namespace Voidstrike.Core.Tests;

public class ProtocolTests
{
    [Theory]
    [InlineData(new byte[] { }, 0xCBF29CE484222325UL)]                 // offset basis
    [InlineData(new byte[] { 0x61 }, 0xAF63DC4C8601EC8CUL)]            // "a"
    [InlineData(new byte[] { 0x66, 0x6F, 0x6F, 0x62, 0x61, 0x72 }, 0x85944171F73967E8UL)] // "foobar"
    public void Fnv1a64_matches_reference_vectors(byte[] data, ulong expected)
    {
        Assert.Equal(expected, Protocol.Fnv1a64(data));
    }

    [Fact]
    public void RulesHash_is_locked_across_implementations()
    {
        // C core + golden ticks.json: rules_hash 0xbfb4742570daa8fb.
        const ulong expected = 0xBFB4742570DAA8FBUL;
        Assert.Equal(expected, Protocol.RulesHash());
    }

    [Theory]
    [InlineData(0.0, 0)]
    [InlineData(1.0, 1000)]
    [InlineData(0.0005, 1)]      // floor(0.5 + 0.5) — banker's rounding would give 0
    [InlineData(1.999, 1999)]
    [InlineData(-1.5, -1500)]
    [InlineData(-0.0004, 0)]
    public void Quantize_uses_floor_plus_half_canonical_form(double v, long expected)
    {
        Assert.Equal(expected, Protocol.Quantize(v));
    }

    [Fact]
    public void Protocol_constants_match_PROTOCOL_v1()
    {
        Assert.Equal(1600.0, Protocol.WorldW);
        Assert.Equal(900.0, Protocol.WorldH);
        Assert.Equal(1.0 / 60.0, Protocol.Dt, 15);
        Assert.Equal(14.0, Protocol.PlayerRadius);
        Assert.Equal(260.0, Protocol.PlayerSpeed);
        Assert.Equal(210.0, Protocol.NovaRadius);
        Assert.Equal(5, Protocol.Obstacles.GetLength(0));
        Assert.Equal("VOIDSTRIKE_SIM_V1", Protocol.RulesSeed);
    }
}

public class SplitMix64Tests
{
    [Fact]
    public void Seed0_sequence_matches_reference()
    {
        var rng = new SplitMix64(0UL);
        Assert.Equal(0x217ADC90477F464DUL, rng.Next());
        Assert.Equal(0xEE276C39D7DF68E9UL, rng.Next());
        Assert.Equal(0x5209979093BC735EUL, rng.Next());
    }

    [Fact]
    public void Seed1_first_output_matches_reference()
    {
        var rng = new SplitMix64(1UL);
        Assert.Equal(0x0B56D7AFBDB0E3CFUL, rng.Next());
    }

    [Fact]
    public void Deterministic_for_equal_seeds()
    {
        var a = new SplitMix64(0xDEADBEEFUL);
        var b = new SplitMix64(0xDEADBEEFUL);
        for (var i = 0; i < 64; i++)
        {
            Assert.Equal(a.Next(), b.Next());
        }
    }
}
