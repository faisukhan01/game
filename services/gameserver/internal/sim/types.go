// VOIDSTRIKE — Protocol v1 · simulation types (Go port of core/c).
package sim

// UnitKind distinguishes players from bots (PROTOCOL §2).
type UnitKind uint8

const (
	KindPlayer UnitKind = 0
	KindBot    UnitKind = 1
)

// Team of a projectile owner (PROTOCOL §5).
type Team uint8

const (
	TeamPlayer Team = 0
	TeamBot    Team = 1
)

// BotState — FSM states (PROTOCOL §7).
type BotState uint8

const (
	StatePatrol BotState = 0
	StateChase  BotState = 1
	StateStrafe BotState = 2
	StateAttack BotState = 3
	StateFlee   BotState = 4
)

// Vec2 is a plain double pair. All sim math is float64.
type Vec2 struct{ X, Y float64 }

// Unit is a player or bot (dead units are retained for checksum stability).
type Unit struct {
	ID     uint32
	Kind   UnitKind
	Alive  bool
	Pos    Vec2
	Vel    Vec2
	Radius float64
	HP     float64
	MaxHP  float64
	Speed  float64
	FireCd float64
	Energy float64
	DashCd float64

	// bot-only deterministic AI state
	State         BotState
	StateTimer    float64
	WaypointTimer float64
	Waypoint      Vec2
	OrbitSign     int
	Wave          uint32
}

// AABB is a static obstacle box.
type AABB struct{ X, Y, W, H float64 }

// Input is the per-tick control for one unit.
type Input struct {
	Move Vec2
	Aim  Vec2
	Fire bool
	Dash bool
	Nova bool
}

// EventKind enumerates sim events emitted per tick.
type EventKind uint8

const (
	EvHit EventKind = iota
	EvKill
	EvDeath
	EvWave
	EvNova
	EvMatchEnd
)

// Event is one sim event (kind-dependent fields).
type Event struct {
	Kind  EventKind
	A, B  uint32
	X, Y  float64
	Value int32
}

// Projectile — fixed slots, lowest free index reused (deterministic).
type Projectile struct {
	ID     uint32
	Owner  uint32
	Alive  bool
	Team   Team
	Pos    Vec2
	Vel    Vec2
	Radius float64
	Damage float64
	Life   float64
}

const (
	WorldW         = 1600.0
	WorldH         = 900.0
	DT             = 0.016666666666666666
	MaxUnits       = 512
	MaxProjectiles = 256
	MaxEvents      = 256
	WaveBotCap     = 63
)

// Obstacles (PROTOCOL §2).
var Obstacles = []AABB{
	{200, 150, 220, 40},
	{1180, 150, 220, 40},
	{200, 710, 220, 40},
	{700, 420, 200, 60},
	{1180, 710, 220, 40},
}

// SpawnPoints — 8 fixed edge points (PROTOCOL §2).
var SpawnPoints = [8][2]float64{
	{80, 80}, {1520, 80}, {80, 820}, {1520, 820},
	{800, 40}, {800, 860}, {40, 450}, {1560, 450},
}
