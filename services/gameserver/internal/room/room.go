// VOIDSTRIKE — room: lifecycle + fan-out for one Versus deathmatch.
package room

import (
	"encoding/json"
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/faisukhan01/game/services/gameserver/internal/sim"
)

const (
	MaxPlayersPerRoom = 8
	RoomSeconds       = 300
	KillLimit         = 25
	SnapshotHz        = 20
	bufferSize        = 64
)

// Client is the transport-facing half of a connected player.
type Client struct {
	ID       uint32
	Callsign string
	Inbox    chan []byte // outbound frames (JSON snapshots/events)
	done     chan struct{}
	once     sync.Once
}

// NewClient constructs a client with a buffered outbound queue.
func NewClient(id uint32, callsign string) *Client {
	return &Client{
		ID:       id,
		Callsign: callsign,
		Inbox:    make(chan []byte, bufferSize),
		done:     make(chan struct{}),
	}
}

// Send queues a frame; drops (never blocks the tick) when the peer is slow.
func (c *Client) Send(b []byte) bool {
	select {
	case c.Inbox <- b:
		return true
	default:
		return false
	}
}

// Close marks the client as gone.
func (c *Client) Close() { c.once.Do(func() { close(c.done) }) }

// Done exposes the close signal.
func (c *Client) Done() <-chan struct{} { return c.done }

// Input is the last-wins control state for one player.
type Input struct {
	MoveX, MoveY float64
	AimX, AimY   float64
	Fire         bool
	Dash         bool
	Nova         bool
}

// Room runs one 60Hz authoritative deathmatch.
type Room struct {
	ID       string
	mu       sync.Mutex
	clients  map[uint32]*Client
	inputs   map[uint32]*Input
	order    []uint32
	world    sim.World
	started  time.Time
	kills    map[uint32]int
	finished bool
	log      *slog.Logger
}

// NewRoom builds a room with a seeded world.
func NewRoom(id string, seed uint64, log *slog.Logger) *Room {
	r := &Room{
		ID:      id,
		clients: map[uint32]*Client{},
		inputs:  map[uint32]*Input{},
		kills:   map[uint32]int{},
		started: time.Now(),
		log:     log,
	}
	r.world.Init(seed)
	return r
}

// Join registers a client and assigns a player id (player 0 is the sim's
// reference entity, so room seats start at 1).
func (r *Room) Join(c *Client) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.clients) >= MaxPlayersPerRoom || r.finished {
		return false
	}
	r.clients[c.ID] = c
	r.inputs[c.ID] = &Input{AimX: 1}
	r.order = append(r.order, c.ID)
	r.log.Info("player joined", "room", r.ID, "player", c.ID, "callsign", c.Callsign)
	return true
}

// Leave removes a client.
func (r *Room) Leave(id uint32) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.clients, id)
	delete(r.inputs, id)
	r.log.Info("player left", "room", r.ID, "player", id)
}

// SetInput stores the last-wins input for a player.
func (r *Room) SetInput(id uint32, in Input) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if cur, ok := r.inputs[id]; ok {
		*cur = in
	}
}

// PlayerCount returns the number of seated players.
func (r *Room) PlayerCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.clients)
}

// Finished reports whether the room ended (kill limit or timer).
func (r *Room) Finished() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.finished
}

// Run drives the fixed 60Hz sim with 20Hz snapshots until context cancel.
func (r *Room) Run(ctx context.Context) {
	r.log.Info("room loop started", "room", r.ID)
	tickC := time.NewTicker(time.Second / 60)
	defer tickC.Stop()
	snap := 0
	for {
		select {
		case <-ctx.Done():
			r.log.Info("room loop ctx done", "room", r.ID)
			return
		case <-tickC.C:
			r.step()
			snap++
			if snap%3 == 0 { // 60Hz / 3 = 20Hz snapshots
				r.broadcast()
			}
			if snap == 3 || snap == 60 {
				r.log.Info("room ticking", "room", r.ID, "snap", snap, "clients", len(r.clients))
			}
		}
	}
}

func (r *Room) step() {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.finished {
		return
	}

	// seat 0 (first player to join) drives sim entity 0 — last-wins input
	in := sim.Input{}
	if len(r.order) > 0 {
		if inp, ok := r.inputs[r.order[0]]; ok {
			in = sim.Input{
				Move: sim.Vec2{X: inp.MoveX, Y: inp.MoveY},
				Aim:  sim.Vec2{X: inp.AimX, Y: inp.AimY},
				Fire: inp.Fire, Dash: inp.Dash, Nova: inp.Nova,
			}
		}
	}
	r.world.Tick(&in)

	// kill tally for the driving player
	for _, e := range r.world.Events {
		if e.Kind == sim.EvKill && len(r.order) > 0 {
			r.kills[r.order[0]]++
		}
	}

	if len(r.order) > 0 && r.kills[r.order[0]] >= KillLimit ||
		time.Since(r.started) > RoomSeconds*time.Second {
		r.finished = true
	}
}

func (r *Room) broadcast() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.clients) == 0 {
		return
	}
	frame := r.snapshotFrame()
	for _, c := range r.clients {
		if ok := c.Send(frame); !ok {
			r.log.Warn("slow client dropped frame", "room", r.ID, "player", c.ID)
		}
	}
}

// snapshotFrame renders the JSON snapshot (PROTOCOL §8).
func (r *Room) snapshotFrame() []byte {
	w := &r.world
	type ent struct {
		ID    uint32  `json:"id"`
		Kind  uint8   `json:"k"`
		X     float64 `json:"x"`
		Y     float64 `json:"y"`
		HP    float64 `json:"hp"`
		Alive bool    `json:"a"`
	}
	ents := make([]ent, 0, w.UnitCount)
	for i := uint32(0); i < w.UnitCount; i++ {
		u := &w.Units[i]
		e := ent{ID: u.ID, Kind: uint8(u.Kind), X: round2(u.Pos.X), Y: round2(u.Pos.Y), HP: round2(u.HP), Alive: u.Alive}
		ents = append(ents, e)
	}
	projs := make([][3]float64, 0, 32)
	for i := range w.Projectiles {
		p := &w.Projectiles[i]
		if p.Alive {
			projs = append(projs, [3]float64{round2(p.Pos.X), round2(p.Pos.Y), float64(p.Team)})
		}
	}
	events := make([]map[string]any, 0, len(w.Events))
	for _, e := range w.Events {
		events = append(events, map[string]any{"kind": int(e.Kind), "a": e.A, "b": e.B, "x": e.X, "y": e.Y, "value": e.Value})
	}
b, err := json.Marshal(map[string]any{
		"t":     "snapshot",
		"tick":  w.TickN,
		"score": w.Score,
		"wave":  w.Wave,
		"over":  w.Over,
		"e":     ents,
		"p":     projs,
		"ev":    events,
	})
	if err != nil {
		r.log.Error("snapshot marshal failed", "room", r.ID, "err", err)
		return nil
	}
	return b
}

func round2(v float64) float64 { return float64(int(v*100)) / 100 }
