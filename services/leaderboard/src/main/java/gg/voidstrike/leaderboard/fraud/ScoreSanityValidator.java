package gg.voidstrike.leaderboard.fraud;

import org.springframework.stereotype.Component;

/**
 * Protocol §10 score sanity check:
 *   score_max = 5000 + kills*500 + wave*400 + duration_sec*2
 * Submissions above the ceiling are rejected outright; statistical
 * outliers vs the player's own history are flagged for review.
 */
@Component
public class ScoreSanityValidator {

    public long ceiling(int kills, int wave, int durationSec) {
        return 5000L + 500L * kills + 400L * wave + 2L * durationSec;
    }

    public Verdict validate(int score, int kills, int wave, int durationSec,
                            Integer playerBest, Integer playerAvg) {
        if (score < 0 || kills < 0 || wave <= 0 || durationSec < 0) {
            return Verdict.REJECT;
        }
        if (score > ceiling(kills, wave, durationSec)) {
            return Verdict.REJECT;
        }
        if (playerBest != null && playerBest > 0 && score > 3L * playerBest) {
            return Verdict.FLAG; // more than 3× personal best — review
        }
        if (playerAvg != null && playerAvg > 50 && score > 10L * playerAvg) {
            return Verdict.FLAG; // 10× running average — review
        }
        return Verdict.ACCEPT;
    }

    public enum Verdict { ACCEPT, FLAG, REJECT }
}
