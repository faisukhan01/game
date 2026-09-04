// VOIDSTRIKE — environment configuration (env-driven).
package config

import (
	"os"
	"strconv"
)

// Config — server configuration.
type Config struct {
	Addr        string
	TickRate    int
	SnapshotHz  int
	MaxRooms    int
	LogLevel    string
}

// FromEnv builds config from environment (defaults per PROTOCOL §8).
func FromEnv() Config {
	c := Config{
		Addr:       ":" + envOr("PORT", "3002"),
		TickRate:   60,
		SnapshotHz: 20,
		MaxRooms:   64,
		LogLevel:   envOr("LOG_LEVEL", "info"),
	}
	if v := os.Getenv("TICK_RATE"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			c.TickRate = n
		}
	}
	if v := os.Getenv("SNAPSHOT_HZ"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			c.SnapshotHz = n
		}
	}
	if v := os.Getenv("MAX_ROOMS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			c.MaxRooms = n
		}
	}
	return c
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
