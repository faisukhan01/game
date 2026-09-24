// VOIDSTRIKE — builds the Arena scene programmatically so the project is
// fully reproducible from source (no binary scene files in git).
using Voidstrike.Game;
using UnityEditor;
using UnityEngine;

namespace Voidstrike.EditorTools
{
    public static class SceneSetup
    {
        [MenuItem("Voidstrike/Build Arena Scene")]
        public static void BuildArenaScene()
        {
            var scene = UnityEditor.SceneManagement.EditorSceneManager.NewScene(
                UnityEditor.SceneManagement.NewSceneSetup.EmptyScene,
                UnityEditor.SceneManagement.NewSceneMode.Single);

            var camGo = new GameObject("Main Camera");
            var cam = camGo.AddComponent<Camera>();
            camGo.tag = "MainCamera";
            cam.orthographic = true;
            cam.orthographicSize = 9.0f * 1.125f; // fit 900 world units tall
            cam.transform.position = new Vector3(8f, 5.06f, -10f);
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.027f, 0.031f, 0.039f); // #07080A

            var lightGo = new GameObject("Lighting");
            lightGo.AddComponent<Light>().type = LightType.Directional;

            var boot = new GameObject("MatchBootstrap");
            boot.AddComponent<MatchBootstrap>();

            UnityEditor.SceneManagement.EditorSceneManager.SaveScene(scene, "Assets/Voidstrike/Scenes/Arena.unity");
            Debug.Log("[Voidstrike] Arena scene built.");
        }
    }
}
