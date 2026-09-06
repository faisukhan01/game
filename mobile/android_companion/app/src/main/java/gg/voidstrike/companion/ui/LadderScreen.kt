package gg.voidstrike.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import gg.voidstrike.companion.data.LadderRow

/** VOIDSTRIKE brand palette (docs/BRAND.md). */
object VsColors {
    val Void = Color(0xFF07080A)
    val Panel = Color(0xFF0E1013)
    val Volt = Color(0xFFC8F31D)
    val Flare = Color(0xFFFF3D5A)
    val Amber = Color(0xFFFFB020)
    val Mint = Color(0xFF29E086)
    val Ink = Color(0xFFE8ECEF)
    val Muted = Color(0xFF8A939E)
}

@Composable
fun LadderScreen(rows: List<LadderRow>, loading: Boolean, error: String?) {
    var tab by remember { mutableStateOf(0) }

    Column(
        Modifier
            .fillMaxSize()
            .background(VsColors.Void),
    ) {
        Text(
            "VOIDSTRIKE",
            color = VsColors.Volt,
            fontSize = 22.sp,
            fontFamily = FontFamily.Monospace,
            modifier = Modifier.padding(16.dp),
        )
        TabRow(selectedTabIndex = tab) {
            Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("SEASON LADDER") })
            Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("MY STATS") })
        }

        when {
            loading -> Text(
                "FETCHING LADDER…",
                color = VsColors.Muted,
                modifier = Modifier.padding(16.dp),
            )
            error != null -> Text(
                "// LINK ERROR: $error",
                color = VsColors.Flare,
                modifier = Modifier.padding(16.dp),
            )
            tab == 0 -> LazyColumn(
                verticalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                items(rows, key = { "${it.callsign}-${it.rank}" }) { row ->
                    Card(
                        colors = CardDefaults.cardColors(
                            containerColor = if (row.rank <= 3) VsColors.Panel else MaterialTheme.colorScheme.surface,
                        ),
                    ) {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text("#${row.rank}  ${row.callsign}", color = VsColors.Ink, fontFamily = FontFamily.Monospace)
                            Text(
                                "${row.bestScore}  W${row.bestWave}",
                                color = if (row.rank == 1) VsColors.Volt else VsColors.Muted,
                                fontFamily = FontFamily.Monospace,
                            )
                        }
                    }
                }
            }
            else -> Text(
                "Sign-in with your callsign after your next deploy.",
                color = VsColors.Muted,
                modifier = Modifier.padding(16.dp),
            )
        }
    }
}
