// VOIDSTRIKE — authoritative-order simulation instance used by the Unity
// client (offline Onslaught). Line-faithful to core/c.
using System.Collections.Generic;
using Voidstrike.Core;

namespace Voidstrike.Game
{
    public sealed class ArenaSimulation
    {
        public struct Fighter
        {
            public int Id;
            public bool Alive;
            public double X, Y, Vx, Vy;
            public double Hp, MaxHp, Speed, Radius;
            public double FireCd, Energy, DashCd;
            public int State;         // bot FSM
            public double StateTimer, WaypointTimer;
            public double Wpx, Wpy;
            public int OrbitSign;
            public int Wave;
        }

        public struct Projectile { public double X, Y, Vx, Vy, Life; public bool FromPlayer; }

        public readonly List<Fighter> Units = new() { new Fighter { Id = 0, Alive = true, X = 800, Y = 300, Hp = 100, MaxHp = 100, Speed = 260, Radius = 14 } };
        public readonly List<Projectile> Bullets = new();

        public int Score, Wave = 1, Combo = 1, Kills;
        public double ComboTimer, Elapsed;
        public bool MatchOver;
        public int AliveBots
        {
            get { int n = 0; for (int i = 1; i < Units.Count; i++) if (Units[i].Alive) n++; return n; }
        }

        private SplitMix64 _rng;
        private int _wavePending = 5;
        private double _spawnTimer = 0.4;
        private int _spawnIdx;
        private static readonly double[,] Obstacles = Protocol.Obstacles;

        public InputFrame LastInput = new();

        public ArenaSimulation(ulong seed) => _rng = new SplitMix64(seed);

        public readonly struct InputFrame
        {
            public InputFrame(double mx, double my, double ax, double ay, bool fire, bool dash, bool nova)
                => (Mx, My, Ax, Ay, Fire, Dash, Nova) = (mx, my, ax, ay, fire, dash, nova);
            public double Mx { get; }
            public double My { get; }
            public double Ax { get; }
            public double Ay { get; }
            public bool Fire { get; }
            public bool Dash { get; }
            public bool Nova { get; }
        }

        public void Tick(InputFrame input)
        {
            if (MatchOver) return;
            LastInput = input;
            Elapsed += Protocol.Dt;
            var p = Units[0];

            if (Combo > 1 && (ComboTimer -= Protocol.Dt) <= 0) Combo = 1;
            for (int i = 0; i < Units.Count; i++)
            {
                var u = Units[i];
                if (u.FireCd > 0) u.FireCd -= Protocol.Dt;
                Units[i] = u;
            }

            // player
            if (p.Alive)
            {
                Move(0, input.Mx, input.My, 1.0);
                if (input.Dash && p.DashCd <= 0)
                {
                    p.DashCd = Protocol.DashCooldown;
                    double dx = input.Mx != 0 || input.My != 0 ? input.Mx : input.Ax;
                    double dy = input.Mx != 0 || input.My != 0 ? input.My : input.Ay;
                    p.Vx += dx * Protocol.DashImpulse;
                    p.Vy += dy * Protocol.DashImpulse;
                }
                if (input.Fire && p.FireCd <= 0 && p.Energy >= Protocol.RifleEnergy)
                {
                    Fire(0, input.Ax, input.Ay, true, 1);
                    p.Energy -= Protocol.RifleEnergy;
                    p.FireCd = Protocol.RifleInterval;
                }
                if (input.Nova && p.Energy >= Protocol.NovaEnergy)
                {
                    p.Energy -= Protocol.NovaEnergy;
                    for (int i = 1; i < Units.Count; i++)
                    {
                        var b = Units[i];
                        if (!b.Alive) continue;
                        double dx = b.X - p.X, dy = b.Y - p.Y, d = System.Math.Sqrt(dx * dx + dy * dy);
                        if (d <= Protocol.NovaRadius)
                        {
                            b.Hp -= Protocol.NovaDamage;
                            b.Vx += dx / (d < 1 ? 1 : d) * Protocol.NovaKnockback;
                            b.Vy += dy / (d < 1 ? 1 : d) * Protocol.NovaKnockback;
                            Units[i] = b;
                        }
                    }
                }
                p.Energy = System.Math.Min(Protocol.EnergyMax, p.Energy + Protocol.EnergyRegen * Protocol.Dt);
                Units[0] = p;
            }

            // bots
            for (int i = 1; i < Units.Count; i++)
            {
                if (!Units[i].Alive) continue;
                UpdateBot(i);
            }

            // projectiles
            for (int i = Bullets.Count - 1; i >= 0; i--)
            {
                var b = Bullets[i];
                b.X += b.Vx * Protocol.Dt;
                b.Y += b.Vy * Protocol.Dt;
                b.Life -= Protocol.Dt;
                bool dead = b.Life <= 0;
                if (!dead && b.FromPlayer)
                {
                    for (int j = 1; j < Units.Count && !dead; j++)
                    {
                        var u = Units[j];
                        if (!u.Alive) continue;
                        double dx = b.X - u.X, dy = b.Y - u.Y, rr = u.Radius + 4;
                        if (dx * dx + dy * dy < rr * rr) { u.Hp -= Protocol.RifleDamage; Units[j] = u; dead = true; }
                    }
                }
                else if (!dead && Units[0].Alive)
                {
                    var u = Units[0];
                    double dx = b.X - u.X, dy = b.Y - u.Y, rr = u.Radius + 4;
                    if (dx * dx + dy * dy < rr * rr) { u.Hp -= 8; Units[0] = u; dead = true; }
                }
                if (dead) Bullets.RemoveAt(i); else Bullets[i] = b;
            }

            // deaths
            for (int i = 1; i < Units.Count; i++)
            {
                var u = Units[i];
                if (u.Alive && u.Hp <= 0)
                {
                    u.Alive = false;
                    Units[i] = u;
                    Kills++;
                    Score += 100 * Combo;
                    Combo = System.Math.Min(Combo + 1, 5);
                    ComboTimer = 3.0;
                }
            }
            if (Units[0].Alive && Units[0].Hp <= 0)
            {
                var u = Units[0];
                u.Alive = false;
                Units[0] = u;
                MatchOver = true;
            }

            // wave director
            if (_wavePending > 0 && _spawnTimer <= 0) { SpawnBot(); _wavePending--; _spawnTimer = 0.4; }
            if (_wavePending == 0 && AliveBots == 0)
            {
                Score += 250 + 50 * Wave;
                Wave++;
                _wavePending = 3 + 2 * Wave;
                _spawnTimer = 0.4;
            }
        }

        private void UpdateBot(int idx)
        {
            var b = Units[idx];
            var p = Units[0];
            double pdx = p.X - b.X, pdy = p.Y - b.Y;
            double dist = System.Math.Sqrt(pdx * pdx + pdy * pdy);
            b.StateTimer -= Protocol.Dt;
            if (b.StateTimer <= 0)
            {
                b.StateTimer = 0.25;
                b.State =
                    b.Hp < 0.25 * b.MaxHp ? 4 :
                    dist < 420 && Los(b.X, b.Y, p.X, p.Y) ? 3 :
                    dist < 260 ? 2 :
                    dist < 520 ? 1 : 0;
                if (b.State == 2 || b.State == 3) b.OrbitSign = _rng.Uniform01() < 0.5 ? -1 : 1;
            }

            double mx = 0, my = 0;
            switch (b.State)
            {
                case 0:
                    b.WaypointTimer -= Protocol.Dt;
                    if (b.WaypointTimer <= 0 || Dist2(b.Wpx, b.Wpy, b.X, b.Y) < 400)
                    {
                        b.Wpx = _rng.Uniform01() * Protocol.WorldW;
                        b.Wpy = _rng.Uniform01() * Protocol.WorldH;
                        b.WaypointTimer = 4.0;
                    }
                    mx = b.Wpx - b.X; my = b.Wpy - b.Y;
                    break;
                case 1: mx = pdx; my = pdy; break;
                case 2:
                case 3: mx = -pdy * b.OrbitSign; my = pdx * b.OrbitSign; break;
                default: mx = -pdx; my = -pdy; break;
            }
            Move(idx, mx, my, b.State == 2 || b.State == 3 ? 0.6 : 1.0);

            if (b.State == 3 && b.FireCd <= 0 && dist < 420 && Los(b.X, b.Y, p.X, p.Y))
            {
                Fire(idx, pdx / dist, pdy / dist, false, b.Wave);
                b.FireCd = 0.85;
                Units[idx] = b;
            }
        }

        private void Fire(int idx, double dx, double dy, bool fromPlayer, int wave)
        {
            double jitterDeg = fromPlayer ? Protocol.RifleSpreadDeg : System.Math.Max(3.0, 12.0 - 0.5 * wave);
            double a = (_rng.Uniform01() * 2.0 - 1.0) * jitterDeg * System.Math.PI / 180.0;
            double c = System.Math.Cos(a), s = System.Math.Sin(a);
            double rx = dx * c - dy * s, ry = dx * s + dy * c;
            var u = Units[idx];
            Bullets.Add(new Projectile
            {
                X = u.X + rx * (u.Radius + 6),
                Y = u.Y + ry * (u.Radius + 6),
                Vx = rx * (fromPlayer ? Protocol.RifleSpeed : 480),
                Vy = ry * (fromPlayer ? Protocol.RifleSpeed : 480),
                Life = fromPlayer ? Protocol.RifleLifetime : 1.6,
                FromPlayer = fromPlayer
            });
        }

        private void Move(int idx, double mx, double my, double mul)
        {
            var u = Units[idx];
            double l = System.Math.Sqrt(mx * mx + my * my);
            double tx = 0, ty = 0;
            if (l > 0) { tx = mx / l * u.Speed * mul; ty = my / l * u.Speed * mul; }
            u.Vx += (tx - u.Vx) * 0.2;
            u.Vy += (ty - u.Vy) * 0.2;
            u.X += u.Vx * Protocol.Dt;
            u.Y += u.Vy * Protocol.Dt;
            Resolve(idx);
        }

        private void Resolve(int idx)
        {
            var u = Units[idx];
            if (u.X < u.Radius) u.X = u.Radius;
            if (u.X > Protocol.WorldW - u.Radius) u.X = Protocol.WorldW - u.Radius;
            if (u.Y < u.Radius) u.Y = u.Radius;
            if (u.Y > Protocol.WorldH - u.Radius) u.Y = Protocol.WorldH - u.Radius;
            for (int k = 0; k < Obstacles.GetLength(0); k++)
            {
                double bx = Obstacles[k, 0], by = Obstacles[k, 1], bw = Obstacles[k, 2], bh = Obstacles[k, 3];
                double cx = Clamp(u.X, bx, bx + bw), cy = Clamp(u.Y, by, by + bh);
                double dx = u.X - cx, dy = u.Y - cy, d2 = dx * dx + dy * dy;
                if (d2 < u.Radius * u.Radius && d2 > 1e-12)
                {
                    double d = System.Math.Sqrt(d2);
                    u.X += dx / d * (u.Radius - d);
                    u.Y += dy / d * (u.Radius - d);
                }
            }
            Units[idx] = u;
        }

        private void SpawnBot()
        {
            double[,] sp = { { 80, 80 }, { 1520, 80 }, { 80, 820 }, { 1520, 820 }, { 800, 40 }, { 800, 860 }, { 40, 450 }, { 1560, 450 } };
            var pt = new double[] { sp[_spawnIdx % 8, 0], sp[_spawnIdx % 8, 1] };
            _spawnIdx++;
            Units.Add(new Fighter
            {
                Id = Units.Count,
                Alive = true,
                X = pt[0],
                Y = pt[1],
                Radius = 14,
                MaxHp = System.Math.Min(30 + 8 * Wave, 90),
                Speed = System.Math.Min(150 + 6 * Wave, 240),
                Wave = Wave,
                StateTimer = 0.25 * (Units.Count % 16) / 16.0
            });
            var b = Units[Units.Count - 1];
            b.Hp = b.MaxHp;
            Units[Units.Count - 1] = b;
        }

        private static bool Los(double x1, double y1, double x2, double y2)
        {
            for (int k = 0; k < Obstacles.GetLength(0); k++)
                if (SegVsBox(x1, y1, x2, y2, Obstacles[k, 0], Obstacles[k, 1], Obstacles[k, 2], Obstacles[k, 3]))
                    return false;
            return true;
        }

        private static bool SegVsBox(double x1, double y1, double x2, double y2, double bx, double by, double bw, double bh)
        {
            double tmin = 0, tmax = 1, dx = x2 - x1, dy = y2 - y1;
            if (System.Math.Abs(dx) < 1e-12) { if (x1 < bx || x1 > bx + bw) return false; }
            else
            {
                double t1 = (bx - x1) / dx, t2 = (bx + bw - x1) / dx;
                if (t1 > t2) { (t1, t2) = (t2, t1); }
                tmin = System.Math.Max(tmin, t1); tmax = System.Math.Min(tmax, t2);
                if (tmin > tmax) return false;
            }
            if (System.Math.Abs(dy) < 1e-12) { if (y1 < by || y1 > by + bh) return false; }
            else
            {
                double t1 = (by - y1) / dy, t2 = (by + bh - y1) / dy;
                if (t1 > t2) { (t1, t2) = (t2, t1); }
                tmin = System.Math.Max(tmin, t1); tmax = System.Math.Min(tmax, t2);
                if (tmin > tmax) return false;
            }
            return true;
        }

        private static double Dist2(double ax, double ay, double bx, double by)
        {
            double dx = ax - bx, dy = ay - by;
            return dx * dx + dy * dy;
        }

        private static double Clamp(double v, double lo, double hi) => v < lo ? lo : (v > hi ? hi : v);
    }
}
