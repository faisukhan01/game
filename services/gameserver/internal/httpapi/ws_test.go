package httpapi

import (
        "net/http/httptest"
        "strings"
        "testing"
        "time"

        "github.com/gorilla/websocket"

        "github.com/faisukhan01/game/services/gameserver/internal/room"
)

func TestWsHelloWelcomeSnapshot(t *testing.T) {
        log := newTestLogger()
        mgr := room.NewManager(4, log)
        s := New(Config{Addr: ":0", MaxRooms: 4}, log)
        srv := httptest.NewServer(s.wsHubHandler())
        defer srv.Close()
        defer mgr.Stop()

        wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
        conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
        if err != nil {
                t.Fatalf("dial: %v", err)
        }
        defer conn.Close()

        if err := conn.WriteJSON(map[string]any{"t": "hello", "callsign": "TESTER"}); err != nil {
                t.Fatalf("hello: %v", err)
        }
        var welcome map[string]any
        if err := conn.ReadJSON(&welcome); err != nil {
                t.Fatalf("welcome: %v", err)
        }
        if welcome["t"] != "welcome" {
                t.Fatalf("expected welcome frame, got %v", welcome)
        }

        // drive inputs and expect snapshots within 2s
        snapshots := 0
        var lastErr error
        deadline := time.Now().Add(2 * time.Second)
        for time.Now().Before(deadline) && snapshots < 3 {
                _ = conn.WriteJSON(map[string]any{"t": "input", "seq": snapshots, "move": []float64{1, 0}})
                conn.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
                var frame map[string]any
                if err := conn.ReadJSON(&frame); err != nil {
                        lastErr = err
                        continue
                }
                if frame["t"] == "snapshot" {
                        snapshots++
                        if tick, ok := frame["tick"].(float64); !ok || tick == 0 {
                                t.Fatalf("snapshot with zero tick: %v", frame)
                        }
                }
        }
        if snapshots < 3 {
                t.Fatalf("expected >=3 snapshots in 2s, got %d (last read err: %v)", snapshots, lastErr)
        }
}
