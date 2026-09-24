package gg.voidstrike.leaderboard;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * VOIDSTRIKE season ladder — Spring Boot entrypoint.
 * Deployed via services/leaderboard/Dockerfile (multi-stage Maven build).
 */
@SpringBootApplication
public class LeaderboardApplication {

    public static void main(String[] args) {
        SpringApplication.run(LeaderboardApplication.class, args);
    }
}
