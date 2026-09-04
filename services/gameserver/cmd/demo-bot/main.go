// VOIDSTRIKE — demo-bot: headless client that joins the arena, sends inputs
// and prints snapshot telemetry. Used for smoke tests and CI soak checks.
package main

import (
	"fmt"
	"log"
	"math"
	"net/url"
	"os"
	"time"

	"github.com/gorilla/websocket"
)

type snapshot struct {
	Tick  uint32 `json:"tick"`
	Score int64  `json:"score"`
	Wave  uint32 `json:"wave"`
	Over  bool   `json:"over"`
	E     []struct {
		ID    uint32  `json:"id"`
		Kind  uint8   `json:"k"`
		X     float64 `json:"x"`
		Y     float64 `json:"y"`
		HP    float64 `json:"hp"`
		Alive bool    `json:"a"`
	} `json:"e"`
}

func main() {
	addr := os.Getenv("SERVER")
	if addr == "" {
		addr = "ws://localhost:3002/ws"
	}
	u, err := url.Parse(addr)
	if err != nil {
		log.Fatal(err)
	}
	conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		log.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	_ = conn.WriteJSON(map[string]any{"t": "hello", "callsign": "DEMO-BOT"})
	var welcome struct {
		T        string `json:"t"`
		PlayerID uint32 `json:"player_id"`
		Seed     uint64 `json:"seed"`
	}
	if err := conn.ReadJSON(&welcome); err != nil {
		log.Fatalf("welcome: %v", err)
	}
	fmt.Printf("welcome: player=%d seed=%d\n", welcome.PlayerID, welcome.Seed)

	tick := 0
	deadline := time.Now().Add(10 * time.Second)
	last := snapshot{}
	for time.Now().Before(deadline) {
		_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		var snap snapshot
		if err := conn.ReadJSON(&snap); err == nil {
			last = snap
		}
		// circle-strafe input, firing at center
		a := float64(tick) * 0.05
		_ = conn.WriteJSON(map[string]any{
			"t":    "input",
			"seq":  tick,
			"move": []float64{math.Cos(a), math.Sin(a)},
			"fire": []float64{math.Cos(a), math.Sin(a)},
		})
		tick++
		time.Sleep(16 * time.Millisecond)
	}
	alive := 0
	for _, e := range last.E {
		if e.Alive {
			alive++
		}
	}
	fmt.Printf("after 10s: tick=%d wave=%d score=%d entities=%d alive=%d\n",
		last.Tick, last.Wave, last.Score, len(last.E), alive)
	if last.Tick == 0 {
		log.Fatal("no snapshots received")
	}
	fmt.Println("DEMO-BOT OK")
}
