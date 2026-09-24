// VOIDSTRIKE — HTTP surface: /ws, /healthz, /readyz, /metrics.
package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/faisukhan01/game/services/gameserver/internal/room"
)

// Config for the HTTP server.
type Config struct {
	Addr     string
	MaxRooms int
}

// Server bundles the mux, room manager and lifecycle.
type Server struct {
	cfg     Config
	log     *slog.Logger
	mgr     *room.Manager
	http    *http.Server
	wsHub   *WsHub
	signals chan os.Signal
}

// New wires the server.
func New(cfg Config, log *slog.Logger) *Server {
	if log == nil {
		log = slog.Default()
	}
	s := &Server{cfg: cfg, log: log, signals: make(chan os.Signal, 1)}
	s.mgr = room.NewManager(cfg.MaxRooms, log)
	s.wsHub = NewWsHub(s.mgr, log)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws", s.wsHub.HandleWS)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"service":"voidstrike-gameserver","protocol":"v1"}`))
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, _ *http.Request) {
		if s.mgr.ActiveRooms() > cfg.MaxRooms {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ready"))
	})
	mux.Handle("GET /metrics", promhttp.Handler())

	s.http = &http.Server{
		Addr:              cfg.Addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	return s
}

// Run blocks until SIGTERM/SIGINT, then drains gracefully.
func (s *Server) Run() error {
	signal.Notify(s.signals, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-s.signals
		s.log.Info("shutdown signal received")
		s.mgr.Stop()
		shutdownCtx, done := context.WithTimeout(context.Background(), 8*time.Second)
		defer done()
		_ = s.http.Shutdown(shutdownCtx)
	}()

	s.log.Info("voidstrike gameserver listening", "addr", s.cfg.Addr, "protocol", "v1")
	err := s.http.ListenAndServe()
	s.mgr.Stop()
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}
