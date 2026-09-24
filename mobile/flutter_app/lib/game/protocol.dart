/// VOIDSTRIKE — Protocol v1 constants shared by the Flutter client.
/// Mirrors docs/PROTOCOL.md exactly (keep in sync with core/c).
library;

class VsWorld {
  static const double width = 1600;
  static const double height = 900;
  static const double dt = 0.016666666666666666; // 1/60
}

class VsPlayer {
  static const double radius = 14;
  static const double maxHp = 100;
  static const double speed = 260;
  static const double energyMax = 100;
  static const double energyRegen = 14;
  static const double dashCooldown = 3.0;
  static const double dashImpulse = 720;
}

class VsRifle {
  static const double fireInterval = 0.1;
  static const double projectileRadius = 4;
  static const double projectileSpeed = 560;
  static const double damage = 10;
  static const double spreadDeg = 2.0;
  static const double lifetime = 1.2;
  static const double energyCost = 2;
}

class VsNova {
  static const double energyCost = 55;
  static const double radius = 210;
  static const double damage = 48;
  static const double knockback = 420;
}

class VsBot {
  static const double radius = 14;
  static const double damage = 8;
  static const double fireInterval = 0.85;
  static const double projectileSpeed = 480;
  static const double projectileLifetime = 1.6;
  static const double spawnStagger = 0.4;

  static double maxHp(int wave) => (30 + 8.0 * wave).clamp(30, 90);
  static double speed(int wave) => (150 + 6.0 * wave).clamp(150, 240);
  static double jitterDeg(int wave) => (12 - 0.5 * wave).clamp(3, 12);
  static int countFor(int wave) => 3 + 2 * wave;
}

/// Brand palette (docs/BRAND.md).
class VsColors {
  static const void_ = 0xFF07080A;
  static const panel = 0xFF0E1013;
  static const ink = 0xFFE8ECEF;
  static const muted = 0xFF8A939E;
  static const volt = 0xFFC8F31D;
  static const flare = 0xFFFF3D5A;
  static const amber = 0xFFFFB020;
  static const mint = 0xFF29E086;
}
