import 'package:flutter_test/flutter_test.dart';
import 'package:voidstrike/game/protocol.dart';

void main() {
  test('Protocol v1 constants match docs/PROTOCOL.md', () {
    expect(VsWorld.width, 1600);
    expect(VsWorld.height, 900);
    expect(VsWorld.dt, 0.016666666666666666);
    expect(VsPlayer.speed, 260);
    expect(VsRifle.fireInterval, 0.1);
    expect(VsNova.energyCost, 55);
    expect(VsBot.countFor(1), 5);
    expect(VsBot.countFor(3), 9);
    expect(VsBot.maxHp(10), 90);
    expect(VsBot.jitterDeg(20), 3.0);
  });
}
