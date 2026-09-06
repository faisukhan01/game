package gg.voidstrike.leaderboard.api;

import gg.voidstrike.leaderboard.domain.Player;
import gg.voidstrike.leaderboard.fraud.ScoreSanityValidator;
import gg.voidstrike.leaderboard.repo.PlayerRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1")
public class LeaderboardController {

    private final PlayerRepository players;
    private final ScoreSanityValidator validator;

    public LeaderboardController(PlayerRepository players, ScoreSanityValidator validator) {
        this.players = players;
        this.validator = validator;
    }

    public record MatchSubmission(
            @NotBlank @Pattern(regexp = "[A-Z0-9_-]{3,16}") String callsign,
            @PositiveOrZero int score,
            @PositiveOrZero int kills,
            @PositiveOrZero int wave,
            @PositiveOrZero int durationSec) {
    }

    public record LadderRow(int rank, String callsign, int bestScore, int bestWave, int matches) {}

    @PostMapping("/matches")
    public ResponseEntity<?> submitMatch(@Valid @RequestBody MatchSubmission sub) {
        Player p = players.findById(sub.callsign()).orElseGet(() -> new Player(sub.callsign()));

        var verdict = validator.validate(sub.score(), sub.kills(), sub.wave(),
                sub.durationSec(), p.getBestScore(),
                p.getMatches() > 0 ? p.getTotalScore() / p.getMatches() : null);

        if (verdict == ScoreSanityValidator.Verdict.REJECT) {
            return ResponseEntity.status(422)
                    .body(Map.of("error", "SCORE_FAILED_SANITY_CHECK", "verdict", verdict.name()));
        }

        p.setTotalScore(p.getTotalScore() + sub.score());
        p.setKills(p.getKills() + sub.kills());
        p.setMatches(p.getMatches() + 1);
        p.setBestWave(Math.max(p.getBestWave(), sub.wave()));
        if (verdict == ScoreSanityValidator.Verdict.ACCEPT) {
            p.setBestScore(Math.max(p.getBestScore(), sub.score()));
        }
        p.setUpdatedAt(Instant.now());
        players.save(p);

        return ResponseEntity.ok(Map.of(
                "verdict", verdict.name(),
                "callsign", p.getCallsign(),
                "bestScore", p.getBestScore()));
    }

    @GetMapping("/leaderboard")
    public List<LadderRow> leaderboard() {
        List<Player> top = players.findTop20ByOrderByBestScoreDesc();
        return java.util.stream.IntStream.range(0, top.size())
                .mapToObj(i -> new LadderRow(i + 1, top.get(i).getCallsign(),
                        top.get(i).getBestScore(), top.get(i).getBestWave(), top.get(i).getMatches()))
                .toList();
    }

    @GetMapping("/players/{callsign}")
    public ResponseEntity<Player> player(@PathVariable String callsign) {
        return players.findById(callsign.toUpperCase())
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }
}
