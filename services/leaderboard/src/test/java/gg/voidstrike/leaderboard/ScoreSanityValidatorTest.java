package gg.voidstrike.leaderboard;

import gg.voidstrike.leaderboard.fraud.ScoreSanityValidator;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ScoreSanityValidatorTest {

    private final ScoreSanityValidator v = new ScoreSanityValidator();

    @Test
    void acceptsLegitimateScore() {
        assertEquals(ScoreSanityValidator.Verdict.ACCEPT,
                v.validate(1200, 8, 3, 95, 900, 400));
    }

    @Test
    void rejectsImpossibleScore() {
        // ceiling = 5000 + 8*500 + 3*400 + 95*2 = 10390
        assertEquals(ScoreSanityValidator.Verdict.REJECT,
                v.validate(99999, 8, 3, 95, null, null));
    }

    @Test
    void flagsThreeTimesPersonalBest() {
        assertEquals(ScoreSanityValidator.Verdict.FLAG,
                v.validate(5000, 8, 3, 95, 1000, null));
    }

    @Test
    void rejectsNegativeInputs() {
        assertEquals(ScoreSanityValidator.Verdict.REJECT,
                v.validate(-5, 1, 1, 10, null, null));
    }
}
