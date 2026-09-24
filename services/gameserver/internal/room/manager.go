// VOIDSTRIKE — room manager: seat assignment and room registry.
package room

import (
	"context"
	"time"
	"fmt"
	"log/slog"
	"math/rand"
	"sync"

	"github.com/faisukhan01/game/services/gameserver/internal/sim"
)

// Manager owns all active rooms and their run loops.
type Manager struct {
	mu       sync.Mutex
	maxRooms int
	nextID   uint32
	rooms    map[string]*Room
	log      *slog.Logger
	ctx      context.Context
	cancel   context.CancelFunc
}

// NewManager builds the registry.
func NewManager(maxRooms int, log *slog.Logger) *Manager {
	if maxRooms <= 0 {
		maxRooms = 64
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &Manager{maxRooms: maxRooms, rooms: map[string]*Room{}, log: log, ctx: ctx, cancel: cancel}
}

// Stop cancels all room run loops.
func (m *Manager) Stop() { m.cancel() }

// ActiveRooms returns the current room count.
func (m *Manager) ActiveRooms() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.rooms)
}

// Join seats the caller in the first non-full, non-finished room (creating
// one when needed) and returns the client handle + room.
func (m *Manager) Join(callsign string) (*Client, *Room, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, r := range m.rooms {
		if !r.Finished() && r.PlayerCount() < MaxPlayersPerRoom {
			m.nextID++
			c := NewClient(m.nextID, callsign)
			if r.Join(c) {
				return c, r, true
			}
		}
	}
	if len(m.rooms) >= m.maxRooms {
		return nil, nil, false
	}

	id := fmt.Sprintf("arena-%04d", len(m.rooms)+1)
	seed := rand.Uint64() // room seed only drives bot variety, not the golden path
	r := NewRoom(id, seed, m.log)
	m.rooms[id] = r

	m.nextID++
	c := NewClient(m.nextID, callsign)
	if !r.Join(c) {
		delete(m.rooms, id)
		return nil, nil, false
	}
	go func() { go r.Run(m.ctx) }() // drive the 60Hz room loop
	go func() {
		// room janitor: drop finished rooms after players leave
		r.WaitEmptyThenClose()
		m.mu.Lock()
		delete(m.rooms, id)
		m.mu.Unlock()
	}()
	return c, r, true
}

// Seed returns the room's sim seed.
func (r *Room) Seed() uint64 { return r.world.ScriptSeed }

// RulesHashHex returns the protocol hash as "0x…".
func (r *Room) RulesHashHex() string { return fmt.Sprintf("0x%016x", sim.RulesHash()) }

// WaitEmptyThenClose blocks until the room is finished and empty, then stops
// its run loop via the finished flag (the Run ticker exits on context; here
// we simply poll — rooms are cheap).
func (r *Room) WaitEmptyThenClose() {
	for {
		r.mu.Lock()
		empty := len(r.clients) == 0
		r.mu.Unlock()
		if empty {
			return
		}
		time.Sleep(PollInterval)
	}
}
