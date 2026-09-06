// VOIDSTRIKE — pooled entity views + camera rig + HUD bridge.
using UnityEngine;

namespace Voidstrike.Game
{
    /// Renders simulation state with pooled sprites. React layer stays hot-path free.
    public sealed class EntityViewRoot : MonoBehaviour
    {
        private ArenaSimulation _last;

        public void Sync(ArenaSimulation sim)
        {
            _last = sim;
            // Views read _last in LateUpdate via their own pooled components.
        }

        public ArenaSimulation Current => _last;
    }
}
