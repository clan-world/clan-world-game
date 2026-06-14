package world.clan.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import world.clan.app.data.ClanWorldConvexClient
import world.clan.app.data.CombinedComm
import world.clan.app.data.SessionStore
import world.clan.app.data.WorldSnapshot
import world.clan.app.data.weiToWhole

data class HearthUiState(
  val isLoading: Boolean = true,
  val isRefreshing: Boolean = false,
  val tick: Long = 0,
  val seasonNumber: Int = 0,
  val seasonStartTick: Long = 0,
  val seasonEndTick: Long = 60,
  val winterActive: Boolean = false,
  /** Ticks remaining until winter, when winter is forecast but not yet active. */
  val winterApproachingInTicks: Long? = null,
  /** Wall-clock millis when the next tick is expected, derived from snap.tickEpoch. */
  val nextTickAtEpochMs: Long? = null,
  val leaderboard: List<LeaderboardRow> = emptyList(),
  val recentComms: List<CombinedComm> = emptyList(),
  val banditAlert: BanditAlert? = null,
  val walletShort: String = "",
  val errorMessage: String? = null,
) {
  data class LeaderboardRow(
    val rank: Int,
    val clanId: Int,
    val name: String,
    val tagline: String,
    val gold: Long,
    val delta: Long,
    val isMine: Boolean,
  )

  /** A bandit visible in the snapshot — surfaced as an alert pill on Hearth. */
  data class BanditAlert(
    val banditId: Int,
    val regionName: String?,
    val tier: Int?,
  )
}

class HearthViewModel(
  private val convex: ClanWorldConvexClient,
  private val sessionStore: SessionStore,
) : ViewModel() {

  private val _state = MutableStateFlow(initial())
  val state: StateFlow<HearthUiState> = _state.asStateFlow()

  init {
    refresh()
    // Auto-refresh every 30s while the VM is alive (i.e. while Hearth is
    // on the back stack). Tick number + leaderboard are how the user reads
    // the world's heartbeat — they should advance without a manual pull.
    // Cancelled cleanly on viewModelScope teardown when the user
    // disconnects (popUpTo(0) clears the back stack).
    viewModelScope.launch {
      while (true) {
        kotlinx.coroutines.delay(REFRESH_INTERVAL_MS)
        if (_state.value.isLoading || _state.value.isRefreshing) continue
        refresh()
      }
    }
  }

  private fun initial(): HearthUiState {
    val s = sessionStore.read()
    val short = s?.solanaPubkeyBase58?.shortenPubkey().orEmpty()
    return HearthUiState(walletShort = short)
  }

  fun refresh() {
    viewModelScope.launch {
      _state.update { it.copy(isRefreshing = true, errorMessage = null) }
      val session = sessionStore.read()
      val selectedClan = session?.selectedClanId ?: DEFAULT_LINKED_CLAN
      val ownedClanIds = (LINKED_CLAN_IDS + sessionStore.getOwnedClanIdsExtra()).toSet()
      runCatching {
        val snap = convex.getSnapshot()
        val comms = runCatching { convex.getCombinedComms(selectedClan, limit = 3) }
          .getOrDefault(emptyList())
          .sortedByDescending { it.tick ?: it.timestamp ?: 0L }
        snap to comms
      }.onSuccess { (snap, comms) ->
        _state.update { _ ->
          project(snap, selectedClan, comms, session?.solanaPubkeyBase58.orEmpty(), ownedClanIds)
        }
      }.onFailure { e ->
        _state.update {
          it.copy(
            isLoading = false,
            isRefreshing = false,
            errorMessage = e.message ?: "Failed to load.",
          )
        }
      }
    }
  }

  private fun project(
    snap: WorldSnapshot,
    selectedClanId: Int,
    comms: List<CombinedComm>,
    solanaPubkey: String,
    ownedClanIds: Set<Int>,
  ): HearthUiState {
    // Sort clans by goldBalance (wei → whole), descending. Empty / null
    // gold goes last.
    val sorted = snap.clans
      .map { c ->
        val gold = c.goldBalance.weiToWhole()
        val clanId = c.id.toIntOrNull() ?: 0
        ClanProjection(c, clanId, gold)
      }
      .sortedByDescending { it.gold }

    val leaderboard = sorted.mapIndexed { i, p ->
      HearthUiState.LeaderboardRow(
        rank = i + 1,
        clanId = p.clanId,
        name = p.clanName,
        tagline = clanTagline(p.clanId),
        gold = p.gold,
        delta = 0L, // no delta data in snapshot — keep at 0 for v0; UI shows "—"
        isMine = ownedClanIds.contains(p.clanId),
      )
    }

    // Season number derived from seasonStartTick / seasonEndTick window length.
    // Defensive: if the snapshot doesn't carry season fields, fall back to a
    // 1 / 60-tick demo window so the banner has something to render.
    val seasonStart = snap.seasonStartTick ?: 0L
    val seasonEnd = snap.seasonEndTick ?: (seasonStart + 60L)
    val seasonNumber = maxOf(1, (seasonStart / 60L).toInt() + 1)

    val banditAlert = snap.bandit?.let { b ->
      val regionName = snap.regions.firstOrNull { it.id.toIntOrNull() == b.region }?.name
      HearthUiState.BanditAlert(
        banditId = b.id,
        regionName = regionName,
        tier = b.tier,
      )
    } ?: snap.activeBanditId?.let { id ->
      HearthUiState.BanditAlert(banditId = id, regionName = null, tier = null)
    }

    val winterApproaching = if (!snap.winterActive) {
      snap.winterStartsAtTick?.let { startsAt ->
        (startsAt - snap.tick).takeIf { it in 1..10 }
      }
    } else null

    // Project the wall-clock time when the next tick should fire. Convex
    // returns startedAt (epoch ms of tick 0) + durationMs (cadence). The
    // banner subtracts System.currentTimeMillis() in a 1Hz LaunchedEffect
    // so the countdown ticks live, even between snapshot refreshes.
    val nextTickAtMs = snap.tickEpoch?.let { ep ->
      val started = ep.startedAt ?: return@let null
      val dur = ep.durationMs ?: return@let null
      if (dur <= 0L) null else started + (snap.tick + 1L) * dur
    }

    return HearthUiState(
      isLoading = false,
      isRefreshing = false,
      tick = snap.tick,
      seasonNumber = seasonNumber,
      seasonStartTick = seasonStart,
      seasonEndTick = seasonEnd,
      winterActive = snap.winterActive,
      winterApproachingInTicks = winterApproaching,
      nextTickAtEpochMs = nextTickAtMs,
      leaderboard = leaderboard,
      recentComms = comms,
      banditAlert = banditAlert,
      walletShort = solanaPubkey.shortenPubkey(),
    )
  }

  private data class ClanProjection(
    val raw: world.clan.app.data.ClanSummary,
    val clanId: Int,
    val gold: Long,
  ) {
    val clanName: String get() = clanLore(clanId)?.name ?: raw.name
  }

  companion object {
    /** Hardcoded "yours" clan set — slice 1 UI demo. Edit one constant to shift. */
    val LINKED_CLAN_IDS = listOf(2, 6, 5)
    const val DEFAULT_LINKED_CLAN = 2

    /**
     * Auto-refresh cadence for the Hearth snapshot. 30s is a balance
     * between "feels live" and "burns the user's data" — the on-chain
     * heartbeat tick cadence is 30s (owner-settable; fired by the
     * dockerized packages/heartbeat runner), so 30s catches roughly one
     * new tick per refresh.
     */
    const val REFRESH_INTERVAL_MS = 30_000L
  }
}

/** Truncate a Base58 pubkey for header display (e.g. "9pK4 · 7vQy"). */
fun String.shortenPubkey(): String {
  if (length < 9) return this
  return "${take(4)} · ${takeLast(4)}"
}

/** Static per-clan flavor lore for the leaderboard subtext. */
private data class ClanLore(val name: String, val tagline: String)

private val LORE: Map<Int, ClanLore> = mapOf(
  1 to ClanLore("Clan Storm-Edge", "blades of the high pass"),
  2 to ClanLore("House Tideborne", "guardians of the strait"),
  3 to ClanLore("Court of Sunhold", "keepers of the gilded oath"),
  4 to ClanLore("Vale-Ward", "tenders of the green"),
  5 to ClanLore("Twilight Watch", "they read the signs"),
  6 to ClanLore("Ember-Kin", "forge before all"),
  7 to ClanLore("Hearth-Forge", "the iron that holds"),
  8 to ClanLore("Star-Walkers", "the line that does not break"),
)

private fun clanLore(clanId: Int): ClanLore? = LORE[clanId]

fun clanTagline(clanId: Int): String = LORE[clanId]?.tagline ?: "—"

fun clanDisplayName(clanId: Int): String = LORE[clanId]?.name ?: "Clan #$clanId"
