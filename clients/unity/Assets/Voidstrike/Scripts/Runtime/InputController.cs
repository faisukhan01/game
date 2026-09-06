// VOIDSTRIKE — input: WASD/arrows + mouse aim + abilities. Legacy polling
// path for maximal portability; the New Input System can be swapped in via
// the same InputFrame surface.
using UnityEngine;

namespace Voidstrike.Game
{
    public sealed class InputController
    {
        public InputController(Camera cam) => _cam = cam;

        private readonly Camera _cam;
        public ArenaSimulation.InputFrame Current { get; private set; }

        public void Poll()
        {
            double mx = Input.GetAxisRaw("Horizontal");
            double my = Input.GetAxisRaw("Vertical");

            var mp = Input.mousePosition;
            var world = _cam != null
                ? _cam.ScreenToWorldPoint(new Vector3(mp.x, mp.y, -_cam.transform.position.z))
                : Vector3.zero;
            double ax = world.x - 800.0, ay = world.y - 300.0; // aim vs player spawn; view layer refines
            double l = System.Math.Sqrt(ax * ax + ay * ay);
            if (l > 1e-6) { ax /= l; ay /= l; } else { ax = 1; ay = 0; }

            Current = new ArenaSimulation.InputFrame(
                mx, my, ax, ay,
                fire: Input.GetMouseButton(0) || Input.GetKey(KeyCode.Space),
                dash: Input.GetKeyDown(KeyCode.LeftShift),
                nova: Input.GetKeyDown(KeyCode.E) || Input.GetMouseButtonDown(1));
        }
    }
}
