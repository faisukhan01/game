package gg.voidstrike.companion.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

/** Live-ops API (Java service). Base URL swapped per environment. */
interface LiveOpsApi {

    @GET("api/v1/leaderboard")
    suspend fun leaderboard(): List<LadderRow>

    @GET("api/v1/players/{callsign}")
    suspend fun player(callsign: String): PlayerStats

    @POST("api/v1/matches")
    suspend fun submitMatch(sub: MatchSubmission): SubmitResult

    companion object {
        fun create(baseUrl: String = "https://liveops.voidstrike.gg/"): LiveOpsApi {
            val json = Json { ignoreUnknownKeys = true }
            return Retrofit.Builder()
                .baseUrl(baseUrl)
                .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
                .build()
                .create(LiveOpsApi::class.java)
        }
    }
}

@Serializable
data class LadderRow(
    val rank: Int,
    val callsign: String,
    val bestScore: Int,
    val bestWave: Int,
    val matches: Int,
)

@Serializable
data class PlayerStats(
    val callsign: String,
    val bestScore: Int = 0,
    val totalScore: Int = 0,
    val matches: Int = 0,
    val kills: Int = 0,
    val bestWave: Int = 0,
)

@Serializable
data class MatchSubmission(
    val callsign: String,
    val score: Int,
    val kills: Int,
    val wave: Int,
    val durationSec: Int,
)

@Serializable
data class SubmitResult(val verdict: String, val callsign: String, val bestScore: Int)
