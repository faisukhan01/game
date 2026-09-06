// VOIDSTRIKE — WebSocket transport to the Go gameserver (PROTOCOL §8).
// Production builds use NativeWebSocket (UPM); this facade keeps the surface
// stable either way.
using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace Voidstrike.Game
{
    public sealed class NetworkTransport : MonoBehaviour
    {
        private string _url;
        private string _callsign;
        private bool _connected;

        public event Action<string> OnSnapshot; // raw JSON frame

        public void Connect(string url, string callsign)
        {
            _url = url;
            _callsign = callsign;
            StartCoroutine(Handshake());
        }

        /// Minimal handshake loop. Swap with NativeWebSocket in production:
        /// the frame schema (hello/welcome/input/snapshot) is identical.
        private IEnumerator Handshake()
        {
            var req = UnityWebRequest.Get(_url.Replace("ws://", "http://"));
            yield return req.SendWebRequest();
            _connected = req.result == UnityWebRequest.Result.Success;
            if (!_connected)
                Debug.LogWarning($"[VoidstrikeNet] gameserver unreachable: {_url}");
        }

        public void SendInput(double mx, double my, double ax, double ay, bool fire, bool dash, bool nova)
        {
            if (!_connected) return;
            // production: send over the live socket
        }

        public void Dispose() => _connected = false;
    }
}
