package gg.voidstrike.leaderboard.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(name = "players")
public class Player {

    @Id
    private String callsign;

    private int bestScore;
    private int totalScore;
    private int matches;
    private int kills;
    private int bestWave;
    private Instant updatedAt = Instant.now();

    public Player() {}

    public Player(String callsign) {
        this.callsign = callsign;
    }

    public String getCallsign() { return callsign; }
    public void setCallsign(String callsign) { this.callsign = callsign; }
    public int getBestScore() { return bestScore; }
    public void setBestScore(int bestScore) { this.bestScore = bestScore; }
    public int getTotalScore() { return totalScore; }
    public void setTotalScore(int totalScore) { this.totalScore = totalScore; }
    public int getMatches() { return matches; }
    public void setMatches(int matches) { this.matches = matches; }
    public int getKills() { return kills; }
    public void setKills(int kills) { this.kills = kills; }
    public int getBestWave() { return bestWave; }
    public void setBestWave(int bestWave) { this.bestWave = bestWave; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
