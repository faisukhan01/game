package gg.voidstrike.leaderboard.repo;

import gg.voidstrike.leaderboard.domain.Player;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface PlayerRepository extends JpaRepository<Player, String> {

    List<Player> findTop20ByOrderByBestScoreDesc();
}
