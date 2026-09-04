package sim

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

// scriptedInput drives the "wave-survival-default" script — byte-identical
// to core/c/scripts/gen_golden.c and documented in docs/PROTOCOL.md §9.
func scriptedInput(w *World) Input {
	waypoints := [4][2]float64{{400, 250}, {1200, 250}, {1200, 650}, {400, 650}}
	p := w.Player()
	in := Input{}

	tx, ty := waypoints[(w.TickN/120)%4][0], waypoints[(w.TickN/120)%4][1]
	dx, dy := tx-p.Pos.X, ty-p.Pos.Y
	dl := math.Sqrt(dx*dx + dy*dy)
	if dl >= 20.0 {
		in.Move.X, in.Move.Y = dx/dl, dy/dl
	}

	var near *Unit
	nd := 0.0
	botsInNova := 0
	for i := uint32(1); i < w.UnitCount; i++ {
		b := &w.Units[i]
		if b.Kind != KindBot || !b.Alive {
			continue
		}
		d := math.Sqrt((b.Pos.X-p.Pos.X)*(b.Pos.X-p.Pos.X) + (b.Pos.Y-p.Pos.Y)*(b.Pos.Y-p.Pos.Y))
		if near == nil || d < nd {
			near, nd = b, d
		}
		if d <= 210.0 {
			botsInNova++
		}
	}
	if near != nil {
		in.Aim.X = (near.Pos.X - p.Pos.X) / nd
		in.Aim.Y = (near.Pos.Y - p.Pos.Y) / nd
		in.Fire = true
		if nd < 150.0 && p.DashCd <= 0 {
			in.Dash = true
			in.Move.X = -(near.Pos.X - p.Pos.X) / nd
			in.Move.Y = -(near.Pos.Y - p.Pos.Y) / nd
		}
	} else {
		in.Aim = Vec2{X: 1, Y: 0}
	}
	if botsInNova >= 2 && p.Energy >= 55.0 {
		in.Nova = true
	}
	return in
}

type goldenCase struct {
	Seed      uint64 `json:"seed"`
	Ticks     int    `json:"ticks"`
	Checksums []struct {
		Tick     int    `json:"tick"`
		Checksum string `json:"checksum"`
	} `json:"checksums"`
}

type goldenFile struct {
	Protocol   string       `json:"protocol"`
	RulesHash  string       `json:"rules_hash"`
	Generator  string       `json:"generator"`
	Script     string       `json:"script"`
	Cases      []goldenCase `json:"cases"`
}

func parseHex(s string) uint64 {
	var v uint64
	for i := 2; i < len(s); i++ {
		var d uint64
		c := s[i]
		switch {
		case c >= '0' && c <= '9':
			d = uint64(c - '0')
		case c >= 'a' && c <= 'f':
			d = uint64(c-'a') + 10
		}
		v = v<<4 | d
	}
	return v
}

// TestGoldenVectors validates the Go port against the C reference core.
// Skips when the golden file has not been generated yet.
func TestGoldenVectors(t *testing.T) {
	const path = "../../../../testdata/golden/ticks.json"
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("golden vectors not generated yet (%v) — run `make -C core/c golden`", err)
	}
	var gf goldenFile
	if err := json.Unmarshal(raw, &gf); err != nil {
		t.Fatalf("parse golden file: %v", err)
	}
	if got := RulesHash(); parseHex(gf.RulesHash) != got {
		t.Fatalf("rules_hash mismatch: file=%s go=%#x", gf.RulesHash, got)
	}
	for _, tc := range gf.Cases {
		w := &World{}
		w.Init(tc.Seed)
		for tk := 1; tk <= tc.Ticks; tk++ {
			in := scriptedInput(w)
			w.Tick(&in)
			if tk%60 == 0 {
				want := tc.Checksums[tk/60-1].Checksum
				got := w.Checksum()
				if parseHex(want) != got {
					t.Fatalf("seed %d tick %d: checksum mismatch want %s got %#x", tc.Seed, tk, want, got)
				}
			}
		}
		t.Logf("seed %d: %d/%d checksums match", tc.Seed, len(tc.Checksums), len(tc.Checksums))
	}
}

func TestRngDeterminism(t *testing.T) {
	a, b := Rng{state: 1337}, Rng{state: 1337}
	for i := 0; i < 1000; i++ {
		if a.Next() != b.Next() {
			t.Fatal("same seed diverged")
		}
	}
	if a.state != b.state {
		t.Fatal("state diverged")
	}
}

func TestWaveProgression(t *testing.T) {
	w := &World{}
	w.Init(1337)
	for t := 0; t < 3600; t++ {
		in := scriptedInput(w)
		w.Tick(&in)
	}
	if w.Wave < 3 {
		t.Fatalf("expected wave >= 3 after 60s scripted run, got %d", w.Wave)
	}
	if w.Score <= 0 {
		t.Fatalf("expected score to accumulate, got %d", w.Score)
	}
}
