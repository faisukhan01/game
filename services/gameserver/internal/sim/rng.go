// VOIDSTRIKE — Protocol v1 · splitmix64 RNG + checksums (Go reference port).
package sim

import "math"

// Rng is the single shared random stream per world (PROTOCOL §4).
type Rng struct {
	state uint64
}

// Next advances the stream and returns the raw 64-bit output.
func (r *Rng) Next() uint64 {
	r.state += 0x9E3779B97F4A7C15
	z := r.state
	z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9
	z = (z ^ (z >> 27)) * 0x94D049BB133111EB
	return z ^ (z >> 27)
}

// Uniform01 returns next() / 2^64 (exact per PROTOCOL §4).
func (r *Rng) Uniform01() float64 {
	return float64(r.Next()) / 18446744073709551616.0
}

// FNV1a64 computes FNV-1a 64 over data (PROTOCOL §1).
func FNV1a64(data []byte) uint64 {
	h := uint64(0xcbf29ce484222325)
	for _, b := range data {
		h ^= uint64(b)
		h *= 0x100000001b3
	}
	return h
}

// RulesHash = FNV1a64("VOIDSTRIKE_SIM_V1").
func RulesHash() uint64 {
	return FNV1a64([]byte("VOIDSTRIKE_SIM_V1"))
}

// Quantize implements the canonical cross-language quantization:
// floor(v*1000 + 0.5) — identical in C/Go/TS/C#/Python (never math.Round).
func Quantize(v float64) int64 {
	return int64(math.Floor(v*1000.0 + 0.5))
}
