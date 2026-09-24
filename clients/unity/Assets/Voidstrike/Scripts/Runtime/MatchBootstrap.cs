// VOIDSTRIKE — bootstrap: owns the sim, the input, the transport and the view.
using System.Collections;
using Voidstrike.Core;
using UnityEngine;

namespace Voidstrike.Game
{
    /// Entry point. Attach to an empty GameObject in the Arena scene.
    /// The Editor scene-builder (EditorSceneSetup) creates this automatically.
    public sealed class MatchBootstrap : MonoBehaviour
    {
        [Header("Match")]
        [SerializeField] private ulong seed = 1337;
        [SerializeField] private bool connectOnline = false;
        [SerializeField] private string serverUrl = "ws://localhost:3002/ws";
        [SerializeField] private string callsign = "STRIKER";

        private ArenaSimulation _sim;
        private InputController _input;
        private NetworkTransport _transport;
        private EntityViewRoot _views;

        private void Awake()
        {
            Application.targetFrameRate = 60;
            _sim = new ArenaSimulation(seed);
            _input = new InputController(GetComponent<Camera>());
            _views = gameObject.AddComponent<EntityViewRoot>();

            if (connectOnline)
            {
                _transport = gameObject.AddComponent<NetworkTransport>();
                _transport.Connect(serverUrl, callsign);
            }
        }

        private void Update()
        {
            _input.Poll();
            // Fixed-step accumulator — never integrate with variable dt.
            _acc += Time.deltaTime;
            int steps = 0;
            while (_acc >= Protocol.Dt && steps < 5)
            {
                _sim.Tick(_input.Current);
                _acc -= Protocol.Dt;
                steps++;
            }
            if (steps >= 5) _acc = 0;

            _views.Sync(_sim);
        }

        private double _acc;

        private void OnDestroy() => _transport?.Dispose();
    }
}
