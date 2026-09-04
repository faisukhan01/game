// VOIDSTRIKE — authoritative Versus arena server (Protocol v1).
package main

import (
	"log/slog"
	"os"

	"github.com/faisukhan01/game/services/gameserver/internal/httpapi"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	addr := os.Getenv("PORT")
	if addr == "" {
		addr = "3002"
	}
	maxRooms := 64
	if v := os.Getenv("MAX_ROOMS"); v != "" {
		n := 0
		for _, c := range v {
			if c < '0' || c > '9' {
				n = 0
				break
			}
			n = n*10 + int(c-'0')
		}
		if n > 0 {
			maxRooms = n
		}
	}
	s := httpapi.New(httpapi.Config{Addr: ":" + addr, MaxRooms: maxRooms}, log)
	if err := s.Run(); err != nil {
		log.Error("server exited with error", "err", err)
		os.Exit(1)
	}
}
