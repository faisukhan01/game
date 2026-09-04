// VOIDSTRIKE — Protocol v1 · world tick (Go port of core/c/src/world.c).
//
// This is a line-faithful port: same constants, same RNG consumption order,
// same tick order. Conformance is enforced by golden_test.go against
// testdata/golden/ticks.json produced by core/c.
package sim

import "math"

// World is the authoritative simulation state for one match.
type World struct {
	rng Rng

	Time     float64
	TickN    uint32
	NextID   uint32
	Score    int64
	Wave     uint32
	Combo    int32
	ComboT   float64
	SurvAcc  float64
	WavePend int32
	SpawnT   float64
	SpawnIdx uint32
	Over     bool

	Units       [MaxUnits]Unit
	UnitCount   uint32
	Projectiles [MaxProjectiles]Projectile
	NextProjID  uint32

	PlayerIdx  uint32
	PlayerLive bool

	Events     []Event
	ScriptSeed uint64
}

func clampd(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func vlen(x, y float64) float64 { return math.Sqrt(x*x + y*y) }

func vnorm(x, y float64) Vec2 {
	l := vlen(x, y)
	if l < 1e-12 {
		return Vec2{}
	}
	return Vec2{X: x / l, Y: y / l}
}

func vrot(x, y, a float64) Vec2 {
	c, s := math.Cos(a), math.Sin(a)
	return Vec2{X: x*c - y*s, Y: x*s + y*c}
}

// segVsAABB — parametric slab clip (PROTOCOL §7 LOS).
func segVsAABB(x1, y1, x2, y2 float64, b *AABB) bool {
	dx, dy := x2-x1, y2-y1
	tmin, tmax := 0.0, 1.0

	if math.Abs(dx) < 1e-12 {
		if x1 < b.X || x1 > b.X+b.W {
			return false
		}
	} else {
		t1 := (b.X - x1) / dx
		t2 := (b.X + b.W - x1) / dx
		if t1 > t2 {
			t1, t2 = t2, t1
		}
		if t1 > tmin {
			tmin = t1
		}
		if t2 < tmax {
			tmax = t2
		}
		if tmin > tmax {
			return false
		}
	}
	if math.Abs(dy) < 1e-12 {
		if y1 < b.Y || y1 > b.Y+b.H {
			return false
		}
	} else {
		t1 := (b.Y - y1) / dy
		t2 := (b.Y + b.H - y1) / dy
		if t1 > t2 {
			t1, t2 = t2, t1
		}
		if t1 > tmin {
			tmin = t1
		}
		if t2 < tmax {
			tmax = t2
		}
		if tmin > tmax {
			return false
		}
	}
	return true
}

func los(w *World, a, b Vec2) bool {
	for i := range Obstacles {
		if segVsAABB(a.X, a.Y, b.X, b.Y, &Obstacles[i]) {
			return false
		}
	}
	return true
}

// resolveAABB — circle vs box push-out (PROTOCOL §5 step 3).
func resolveAABB(pos, vel *Vec2, r float64, b *AABB) {
	cx := clampd(pos.X, b.X, b.X+b.W)
	cy := clampd(pos.Y, b.Y, b.Y+b.H)
	dx, dy := pos.X-cx, pos.Y-cy
	d2 := dx*dx + dy*dy
	if d2 > r*r {
		return
	}
	if d2 > 1e-12 {
		d := math.Sqrt(d2)
		nx, ny := dx/d, dy/d
		pos.X += nx * (r - d)
		pos.Y += ny * (r - d)
		if vn := vel.X*nx + vel.Y*ny; vn < 0 {
			vel.X -= nx * vn
			vel.Y -= ny * vn
		}
	} else {
		dl := pos.X - b.X
		dr := b.X + b.W - pos.X
		dtp := pos.Y - b.Y
		db := b.Y + b.H - pos.Y
		m := dl
		if dr < m {
			m = dr
		}
		if dtp < m {
			m = dtp
		}
		if db < m {
			m = db
		}
		switch m {
		case dl:
			pos.X = b.X - r
			vel.X = 0
		case dr:
			pos.X = b.X + b.W + r
			vel.X = 0
		case dtp:
			pos.Y = b.Y - r
			vel.Y = 0
		default:
			pos.Y = b.Y + b.H + r
			vel.Y = 0
		}
	}
}

func (w *World) pushEvent(e Event) {
	if len(w.Events) < MaxEvents {
		w.Events = append(w.Events, e)
	}
}

func (w *World) spawnProjectile(team Team, owner uint32, pos, dir Vec2, speed, radius, damage, life float64) {
	for i := range w.Projectiles {
		p := &w.Projectiles[i]
		if !p.Alive {
			p.ID = w.NextProjID
			w.NextProjID++
			p.Owner = owner
			p.Alive = true
			p.Team = team
			p.Pos = pos
			p.Vel = Vec2{X: dir.X * speed, Y: dir.Y * speed}
			p.Radius = radius
			p.Damage = damage
			p.Life = life
			return
		}
	}
}

func botJitterMax(wave uint32) float64 {
	deg := 12.0 - 0.5*float64(wave)
	if deg < 3.0 {
		deg = 3.0
	}
	return deg * (math.Pi / 180.0)
}

func botMaxHP(wave uint32) float64 {
	v := 30.0 + 8.0*float64(wave)
	if v > 90.0 {
		v = 90.0
	}
	return v
}

func botSpeed(wave uint32) float64 {
	v := 150.0 + 6.0*float64(wave)
	if v > 240.0 {
		v = 240.0
	}
	return v
}

func (w *World) spawnBot() {
	if w.UnitCount >= MaxUnits {
		return
	}
	b := &w.Units[w.UnitCount]
	b.Wave = w.Wave
	b.ID = w.NextID
	w.NextID++
	b.Kind = KindBot
	b.Alive = true
	b.Radius = 14.0
	b.HP = botMaxHP(b.Wave)
	b.MaxHP = b.HP
	b.Speed = botSpeed(b.Wave)
	sp := SpawnPoints[w.SpawnIdx%8]
	w.SpawnIdx++
	b.Pos = Vec2{X: sp[0], Y: sp[1]}
	b.State = StatePatrol
	// deterministic stagger: 0.25 * ((id % 16) / 16)
	b.StateTimer = 0.25 * (float64(b.ID%16) / 16.0)
	w.UnitCount++
}

// Init resets the world to Protocol v1 initial state.
func (w *World) Init(seed uint64) {
	*w = World{}
	w.rng.state = seed
	w.ScriptSeed = seed
	w.Wave = 1
	w.Combo = 1
	w.WavePend = 3 + 2*1
	w.SpawnT = 0.4
	w.PlayerLive = true

	p := &w.Units[0]
	p.ID = w.NextID
	w.NextID++
	p.Kind = KindPlayer
	p.Alive = true
	p.Radius = 14.0
	p.HP, p.MaxHP = 100.0, 100.0
	p.Speed = 260.0
	p.Pos = Vec2{X: 800.0, Y: 300.0}
	p.Energy = 100.0
	w.UnitCount = 1
	w.PlayerIdx = 0
}

// AliveBots counts living bots.
func (w *World) AliveBots() int {
	n := 0
	for i := uint32(0); i < w.UnitCount; i++ {
		u := &w.Units[i]
		if u.Kind == KindBot && u.Alive {
			n++
		}
	}
	return n
}

// Player returns the player unit.
func (w *World) Player() *Unit { return &w.Units[w.PlayerIdx] }

// ---- bot FSM (PROTOCOL §7) ----

func (w *World) botReevaluate(b *Unit, p *Unit) {
	dist := vlen(p.Pos.X-b.Pos.X, p.Pos.Y-b.Pos.Y)
	var ns BotState
	switch {
	case b.HP < 0.25*b.MaxHP:
		ns = StateFlee
	case dist < 420.0 && los(w, b.Pos, p.Pos):
		ns = StateAttack
	case dist < 260.0:
		ns = StateStrafe
	case dist < 520.0:
		ns = StateChase
	default:
		ns = StatePatrol
	}
	if ns != b.State {
		b.State = ns
		if ns == StateStrafe || ns == StateAttack {
			if w.rng.Uniform01() < 0.5 { // 1 draw
				b.OrbitSign = -1
			} else {
				b.OrbitSign = 1
			}
		}
		if ns == StatePatrol {
			b.WaypointTimer = 0
		}
	}
}

func (w *World) fleeDir(b *Unit, p *Unit) Vec2 {
	best, bestD := 0, -1.0
	for i := range Obstacles {
		cx := Obstacles[i].X + Obstacles[i].W*0.5
		cy := Obstacles[i].Y + Obstacles[i].H*0.5
		d := vlen(cx-b.Pos.X, cy-b.Pos.Y)
		if bestD < 0 || d < bestD {
			bestD, best = d, i
		}
	}
	if len(Obstacles) > 0 {
		ob := &Obstacles[best]
		corners := [4][2]float64{{0, 0}, {1, 0}, {0, 1}, {1, 1}}
		bx, by, bd := 0.0, 0.0, -1.0
		for k := range corners {
			cx := ob.X + corners[k][0]*ob.W
			cy := ob.Y + corners[k][1]*ob.H
			dp := vlen(cx-p.Pos.X, cy-p.Pos.Y)
			if dp > bd {
				bd, bx, by = dp, cx, cy
			}
		}
		return vnorm(bx-b.Pos.X, by-b.Pos.Y)
	}
	return vnorm(b.Pos.X-p.Pos.X, b.Pos.Y-p.Pos.Y)
}

func (w *World) botUpdate(b *Unit, p *Unit) Vec2 {
	dist := vlen(p.Pos.X-b.Pos.X, p.Pos.Y-b.Pos.Y)
	b.StateTimer -= DT
	if b.StateTimer <= 0 {
		b.StateTimer = 0.25
		w.botReevaluate(b, p)
	}

	var dir Vec2
	switch b.State {
	case StatePatrol:
		b.WaypointTimer -= DT
		wd := vlen(b.Waypoint.X-b.Pos.X, b.Waypoint.Y-b.Pos.Y)
		if b.WaypointTimer <= 0 || wd < 20.0 {
			// 2 draws: x, then y (PROTOCOL §4 order)
			b.Waypoint.X = w.rng.Uniform01() * WorldW
			b.Waypoint.Y = w.rng.Uniform01() * WorldH
			b.WaypointTimer = 4.0
		}
		dir = vnorm(b.Waypoint.X-b.Pos.X, b.Waypoint.Y-b.Pos.Y)
	case StateChase:
		dir = vnorm(p.Pos.X-b.Pos.X, p.Pos.Y-b.Pos.Y)
	case StateStrafe, StateAttack:
		toP := vnorm(p.Pos.X-b.Pos.X, p.Pos.Y-b.Pos.Y)
		dir = Vec2{X: -toP.Y * float64(b.OrbitSign), Y: toP.X * float64(b.OrbitSign)}
	default:
		dir = w.fleeDir(b, p)
	}

	if b.State == StateAttack && b.FireCd <= 0 && w.PlayerLive &&
		dist < 420.0 && los(w, b.Pos, p.Pos) {
		aim := vnorm(p.Pos.X-b.Pos.X, p.Pos.Y-b.Pos.Y)
		if aim.X == 0 && aim.Y == 0 {
			aim = Vec2{X: 1, Y: 0}
		}
		b.FireCd = 0.85
		jitter := (w.rng.Uniform01()*2.0 - 1.0) * botJitterMax(b.Wave) // 1 draw
		d := vrot(aim.X, aim.Y, jitter)
		pos := Vec2{X: b.Pos.X + d.X*(b.Radius+6.0), Y: b.Pos.Y + d.Y*(b.Radius+6.0)}
		w.spawnProjectile(TeamBot, b.ID, pos, d, 480.0, 4.0, 8.0, 1.6)
	}
	return dir
}

// Tick advances exactly one fixed tick (dt = 1/60).
func (w *World) Tick(in *Input) {
	var zero Input
	if in == nil {
		in = &zero
	}
	w.Events = w.Events[:0]

	// ---- 1. timers ----
	w.Time += DT
	w.TickN++
	if w.Combo > 1 {
		w.ComboT -= DT
		if w.ComboT <= 0 {
			w.Combo = 1
		}
	}
	for i := uint32(0); i < w.UnitCount; i++ {
		if w.Units[i].FireCd > 0 {
			w.Units[i].FireCd -= DT
		}
		if w.Units[i].DashCd > 0 {
			w.Units[i].DashCd -= DT
		}
	}
	if w.SpawnT > 0 {
		w.SpawnT -= DT
	}

	player := w.Player()
	aimDir := Vec2{X: 1, Y: 0}
	if al := vlen(in.Aim.X, in.Aim.Y); al >= 1e-12 {
		aimDir = Vec2{X: in.Aim.X / al, Y: in.Aim.Y / al}
	}

	// ---- 2. movement (player, then bots ascending) ----
	if w.PlayerLive {
		dir := Vec2{}
		if ml := vlen(in.Move.X, in.Move.Y); ml > 1.0 {
			dir = Vec2{X: in.Move.X / ml, Y: in.Move.Y / ml}
		} else if ml > 0 {
			dir = in.Move
		}
		if in.Dash && player.DashCd <= 0 {
			player.DashCd = 3.0
			dd := dir
			if dd.X == 0 && dd.Y == 0 {
				dd = aimDir
			}
			if dd.X == 0 && dd.Y == 0 {
				dd = Vec2{X: 1, Y: 0}
			}
			player.Vel.X += dd.X * 720.0
			player.Vel.Y += dd.Y * 720.0
		}
		player.Vel.X += (dir.X*player.Speed - player.Vel.X) * 0.2
		player.Vel.Y += (dir.Y*player.Speed - player.Vel.Y) * 0.2
		player.Pos.X += player.Vel.X * DT
		player.Pos.Y += player.Vel.Y * DT

		if in.Fire && player.FireCd <= 0 && player.Energy >= 2.0 {
			spread := (w.rng.Uniform01()*2.0 - 1.0) * (2.0 * (math.Pi / 180.0)) // 1 draw
			d := vrot(aimDir.X, aimDir.Y, spread)
			pos := Vec2{X: player.Pos.X + d.X*(player.Radius+6.0), Y: player.Pos.Y + d.Y*(player.Radius+6.0)}
			player.Energy -= 2.0
			player.FireCd = 0.1
			w.spawnProjectile(TeamPlayer, player.ID, pos, d, 560.0, 4.0, 10.0, 1.2)
		}
	}

	for i := uint32(1); i < w.UnitCount; i++ {
		b := &w.Units[i]
		if !b.Alive {
			continue
		}
		dir := w.botUpdate(b, player)
		mul := 1.0
		if b.State == StateStrafe || b.State == StateAttack {
			mul = 0.6
		}
		b.Vel.X += (dir.X*b.Speed*mul - b.Vel.X) * 0.2
		b.Vel.Y += (dir.Y*b.Speed*mul - b.Vel.Y) * 0.2
		b.Pos.X += b.Vel.X * DT
		b.Pos.Y += b.Vel.Y * DT
	}

	// ---- 3. world resolve ----
	for i := uint32(0); i < w.UnitCount; i++ {
		u := &w.Units[i]
		if !u.Alive {
			continue
		}
		if u.Pos.X < u.Radius {
			u.Pos.X = u.Radius
			if u.Vel.X < 0 {
				u.Vel.X = 0
			}
		}
		if u.Pos.X > WorldW-u.Radius {
			u.Pos.X = WorldW - u.Radius
			if u.Vel.X > 0 {
				u.Vel.X = 0
			}
		}
		if u.Pos.Y < u.Radius {
			u.Pos.Y = u.Radius
			if u.Vel.Y < 0 {
				u.Vel.Y = 0
			}
		}
		if u.Pos.Y > WorldH-u.Radius {
			u.Pos.Y = WorldH - u.Radius
			if u.Vel.Y > 0 {
				u.Vel.Y = 0
			}
		}
		for k := range Obstacles {
			resolveAABB(&u.Pos, &u.Vel, u.Radius, &Obstacles[k])
		}
	}

	// ---- 5. projectiles ----
	for i := range w.Projectiles {
		p := &w.Projectiles[i]
		if !p.Alive {
			continue
		}
		despawn := false
		p.Pos.X += p.Vel.X * DT
		p.Pos.Y += p.Vel.Y * DT
		p.Life -= DT
		if p.Life <= 0 {
			despawn = true
		}
		if !despawn && (p.Pos.X < 0 || p.Pos.X > WorldW || p.Pos.Y < 0 || p.Pos.Y > WorldH) {
			despawn = true
		}
		if !despawn {
			for k := range Obstacles {
				b := &Obstacles[k]
				cx := clampd(p.Pos.X, b.X, b.X+b.W)
				cy := clampd(p.Pos.Y, b.Y, b.Y+b.H)
				dx, dy := p.Pos.X-cx, p.Pos.Y-cy
				if dx*dx+dy*dy < p.Radius*p.Radius {
					despawn = true
					break
				}
			}
		}
		if !despawn {
			if p.Team == TeamPlayer {
				for j := uint32(1); j < w.UnitCount && !despawn; j++ {
					u := &w.Units[j]
					if !u.Alive || u.Kind != KindBot {
						continue
					}
					dx, dy := p.Pos.X-u.Pos.X, p.Pos.Y-u.Pos.Y
					rr := p.Radius + u.Radius
					if dx*dx+dy*dy < rr*rr {
						u.HP -= p.Damage
						w.pushEvent(Event{Kind: EvHit, A: p.ID, B: u.ID, X: p.Pos.X, Y: p.Pos.Y, Value: int32(p.Damage)})
						despawn = true
					}
				}
			} else if w.PlayerLive {
				u := w.Player()
				dx, dy := p.Pos.X-u.Pos.X, p.Pos.Y-u.Pos.Y
				rr := p.Radius + u.Radius
				if dx*dx+dy*dy < rr*rr {
					u.HP -= p.Damage
					w.pushEvent(Event{Kind: EvHit, A: p.ID, B: u.ID, X: p.Pos.X, Y: p.Pos.Y, Value: int32(p.Damage)})
					despawn = true
				}
			}
		}
		if despawn {
			p.Alive = false
		}
	}

	// ---- 6. nova (player) ----
	if w.PlayerLive && in.Nova && player.Energy >= 55.0 {
		player.Energy -= 55.0
		w.pushEvent(Event{Kind: EvNova, A: player.ID, X: player.Pos.X, Y: player.Pos.Y})
		for i := uint32(1); i < w.UnitCount; i++ {
			b := &w.Units[i]
			if !b.Alive || b.Kind != KindBot {
				continue
			}
			dx, dy := b.Pos.X-player.Pos.X, b.Pos.Y-player.Pos.Y
			if d := vlen(dx, dy); d <= 210.0 {
				n := vnorm(dx, dy)
				b.HP -= 48.0
				b.Vel.X += n.X * 420.0
				b.Vel.Y += n.Y * 420.0
			}
		}
	}

	// ---- 7. deaths ----
	for i := uint32(0); i < w.UnitCount; i++ {
		u := &w.Units[i]
		if !u.Alive || u.HP > 0 {
			continue
		}
		u.Alive = false
		if u.Kind == KindBot {
			w.Score += 100 * int64(w.Combo)
			if w.Combo < 5 {
				w.Combo++
			}
			w.ComboT = 3.0
			w.pushEvent(Event{Kind: EvKill, A: u.ID, X: u.Pos.X, Y: u.Pos.Y, Value: w.Combo})
		} else {
			w.PlayerLive = false
			w.Over = true
			w.pushEvent(Event{Kind: EvDeath, A: u.ID, X: u.Pos.X, Y: u.Pos.Y})
			w.pushEvent(Event{Kind: EvMatchEnd, A: u.ID, X: u.Pos.X, Y: u.Pos.Y, Value: int32(w.Wave)})
		}
	}

	// ---- 8. regen ----
	if w.PlayerLive && player.Energy < 100.0 {
		player.Energy += 14.0 * DT
		if player.Energy > 100.0 {
			player.Energy = 100.0
		}
	}

	// ---- 9. survival score ----
	w.SurvAcc += DT
	for w.SurvAcc >= 1.0 {
		w.SurvAcc -= 1.0
		if !w.Over {
			w.Score++
		}
	}

	// ---- 10. wave director ----
	if w.WavePend > 0 && w.SpawnT <= 0 && !w.Over {
		w.spawnBot()
		w.WavePend--
		w.SpawnT = 0.4
	}
	if w.WavePend == 0 && !w.Over && w.AliveBots() == 0 && w.TickN > 1 {
		w.Score += 250 + 50*int64(w.Wave)
		w.Wave++
		w.WavePend = 3 + 2*int32(w.Wave)
		if w.WavePend > WaveBotCap {
			w.WavePend = WaveBotCap
		}
		w.SpawnT = 0.4
		w.pushEvent(Event{Kind: EvWave, Value: int32(w.Wave)})
	}
}

// Checksum — byte-exact with core/c (PROTOCOL §5 step 11).
func (w *World) Checksum() uint64 {
	h := uint64(0xcbf29ce484222325)
	mix := func(b byte) { h ^= uint64(b); h *= 0x100000001b3 }
	mixU32 := func(v uint32) {
		mix(byte(v)); mix(byte(v >> 8)); mix(byte(v >> 16)); mix(byte(v >> 24))
	}
	mixI64 := func(v int64) {
		u := uint64(v)
		for i := 0; i < 8; i++ {
			mix(byte(u >> (8 * i)))
		}
	}
	for i := uint32(0); i < w.UnitCount; i++ {
		u := &w.Units[i]
		mixU32(u.ID)
		mixI64(Quantize(u.Pos.X))
		mixI64(Quantize(u.Pos.Y))
		mixI64(Quantize(u.Vel.X))
		mixI64(Quantize(u.Vel.Y))
		mixI64(Quantize(u.HP))
		mix(byte(u.Kind))
		if u.Alive {
			mix(1)
		} else {
			mix(0)
		}
	}
	mixU32(w.UnitCount)
	mixI64(w.Score)
	mixU32(w.Wave)
	mixI64(int64(RulesHash()))
	return h
}
