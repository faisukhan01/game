package gg.voidstrike.companion

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import gg.voidstrike.companion.data.LadderRow
import gg.voidstrike.companion.data.LiveOpsApi
import gg.voidstrike.companion.ui.LadderScreen
import gg.voidstrike.companion.ui.VsColors
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val api = LiveOpsApi.create()

        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    background = VsColors.Void,
                    surface = VsColors.Panel,
                    primary = VsColors.Volt,
                    error = VsColors.Flare,
                ),
            ) {
                var rows by remember { mutableStateOf<List<LadderRow>>(emptyList()) }
                var loading by remember { mutableStateOf(true) }
                var error by remember { mutableStateOf<String?>(null) }

                androidx.compose.runtime.LaunchedEffect(Unit) {
                    kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main).launch {
                        runCatching { api.leaderboard() }
                            .onSuccess { rows = it; loading = false }
                            .onFailure { error = it.message ?: "unknown"; loading = false }
                    }
                }

                LadderScreen(rows, loading, error)
            }
        }
    }
}
