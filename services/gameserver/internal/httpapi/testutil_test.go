package httpapi

import (
	"log/slog"
	"net/http"
	"os"
)

func newTestLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug}))
}

// wsHubHandler exposes just the WS route for httptest.
func (s *Server) wsHubHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws", s.wsHub.HandleWS)
	return mux
}
