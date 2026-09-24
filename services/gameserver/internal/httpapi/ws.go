// VOIDSTRIKE — WebSocket transport (PROTOCOL §8): JSON frames, 5s ping,
// 3s disconnect cleanup, last-wins inputs.
package httpapi

import (
        "log/slog"
        "net/http"
        "sync"
        "time"

        "github.com/gorilla/websocket"

        "github.com/faisukhan01/game/services/gameserver/internal/room"
)

const (
        writeWait  = 5 * time.Second
        pongWait   = 5 * time.Second
        maxMsgSize = 4096
)

var upgrader = websocket.Upgrader{
        ReadBufferSize:  1024,
        WriteBufferSize: 4096,
        CheckOrigin: func(r *http.Request) bool {
                // Same-origin via the edge gateway; cross-origin allowed for dev clients.
                return true
        },
}

// frameIn — client → server frames.
type frameIn struct {
        T        string    `json:"t"`
        Callsign string    `json:"callsign"`
        Seq      int       `json:"seq"`
        Move     []float64 `json:"move"`
        Fire     []float64 `json:"fire"`
        Dash     bool      `json:"dash"`
        Nova     bool      `json:"nova"`
}

// frameOut — server → client frames.
type frameOut struct {
        T          string `json:"t"`
        PlayerID   uint32 `json:"player_id,omitempty"`
        Seed       uint64 `json:"seed,omitempty"`
        TickRate   int    `json:"tick_rate,omitempty"`
        SnapshotHz int    `json:"snapshot_hz,omitempty"`
        RulesHash  string `json:"rules_hash,omitempty"`
        Reason     string `json:"reason,omitempty"`
}

// WsHub owns upgrades and per-connection pumps.
type WsHub struct {
        mgr *room.Manager
        log *slog.Logger
        mu  sync.Mutex
}

// NewWsHub builds the hub.
func NewWsHub(mgr *room.Manager, log *slog.Logger) *WsHub {
        return &WsHub{mgr: mgr, log: log}
}

// HandleWS upgrades and seats the client.
func (h *WsHub) HandleWS(w http.ResponseWriter, r *http.Request) {
        conn, err := upgrader.Upgrade(w, r, nil)
        if err != nil {
                h.log.Warn("ws upgrade failed", "err", err)
                return
        }
        conn.SetReadLimit(maxMsgSize)

        // first frame must be hello
        conn.SetReadDeadline(time.Now().Add(pongWait))
        var hello frameIn
        if err := conn.ReadJSON(&hello); err != nil || hello.T != "hello" {
                _ = conn.WriteJSON(frameOut{T: "error", Reason: "expected hello frame"})
                _ = conn.Close()
                return
        }
        callsign := hello.Callsign
        if len(callsign) > 24 {
                callsign = callsign[:24]
        }

        cl, room, ok := h.mgr.Join(callsign)
        if !ok {
                _ = conn.WriteJSON(frameOut{T: "full", Reason: "server at capacity"})
                _ = conn.Close()
                return
        }

        welcome := frameOut{
                T:          "welcome",
                PlayerID:   cl.ID,
                Seed:       room.Seed(),
                TickRate:   60,
                SnapshotHz: 20,
                RulesHash:  room.RulesHashHex(),
        }
        if err := conn.WriteJSON(welcome); err != nil {
                room.Leave(cl.ID)
                _ = conn.Close()
                return
        }

        h.log.Info("client connected", "player", cl.ID, "room", room.ID)
        go h.writePump(conn, cl, room)
        h.readPump(conn, cl, room)
}

// readPump — inbound frames until close/error; keeps pong deadlines.
func (h *WsHub) readPump(conn *websocket.Conn, cl *room.Client, rm *room.Room) {
        defer func() {
                rm.Leave(cl.ID)
                cl.Close()
                _ = conn.Close()
                h.log.Info("client disconnected", "player", cl.ID, "room", rm.ID)
        }()
        for {
                conn.SetReadDeadline(time.Now().Add(pongWait))
                var f frameIn
                if err := conn.ReadJSON(&f); err != nil {
                        h.log.Warn("readPump exiting", "player", cl.ID, "err", err)
                        return
                }
                switch f.T {
                case "input":
                        in := room.Input{Dash: f.Dash, Nova: f.Nova}
                        if len(f.Move) == 2 {
                                in.MoveX, in.MoveY = f.Move[0], f.Move[1]
                        }
                        if len(f.Fire) == 2 {
                                in.AimX, in.AimY = f.Fire[0], f.Fire[1]
                                in.Fire = true
                        }
                        rm.SetInput(cl.ID, in)
                case "ping":
                        _ = conn.WriteJSON(frameOut{T: "pong"})
                default:
                        // unknown frame — ignore (protocol tolerant)
                }
        }
}

// writePump — outbound frames from the room inbox.
func (h *WsHub) writePump(conn *websocket.Conn, cl *room.Client, rm *room.Room) {
        ticker := time.NewTicker(pongWait / 2)
        defer func() {
                ticker.Stop()
                _ = conn.Close()
        }()
        for {
                select {
                case <-cl.Done():
                        h.log.Warn("writePump client done", "player", cl.ID)
                        return
                case msg := <-cl.Inbox:
                        conn.SetWriteDeadline(time.Now().Add(writeWait))
                        if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
                                h.log.Warn("writePump write failed", "player", cl.ID, "err", err)
                                return
                        }
                case <-ticker.C:
                        conn.SetWriteDeadline(time.Now().Add(writeWait))
                        if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
                                return
                        }
                }
        }
}
