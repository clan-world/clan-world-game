# The strategy ladder — deep dive

Companion to `SKILL.md`. The skill is the mid-tick skim (the table + the cheap thresholds). This file is the reasoning underneath each rung, the diplomacy playbook, the winter arithmetic, and worked examples. Pull it when a rung's call isn't obvious or you're deciding whether to escalate into diplomacy.

## The win, grounded in the engine

**You win by building the tallest Monument, fastest.** Season-end rank order:

1. **Monument level** (highest wins)
2. **earliest reached** (tie → who got there first)
3. **weighted loot** `w + wheat + 2·fish + 4·iron` (the vault-value tiebreak — iron is worth 4×, so a late surplus of iron is the best tiebreak hoard)
4. **wall** level
5. **clanId** (final deterministic tiebreak)

**Survival is the GATE, not the goal.** A dead clan scores 0. But a clan that merely survives — vault full, monument at L2 — *also* scores ~0 against a rival at L7. So don't confuse "alive and comfortable" with "winning." Comfort is the floor you stand on to build; it is not the build.

This reframes the whole ladder:

- **Survival rungs (1 FOOD, 2 WOOD, 4 DEFENSE) INTERRUPT the build.** They're gates you must clear, not goals you pursue. Clear them with the *minimum* viable allocation, then return surplus to the monument.
- **The BUILD rung (3) is the DEFAULT SINK.** Any clansman not pinned to a survival gate or a diplomacy play belongs on the monument supply chain. It never "fully yields" — it's where idle capacity goes.
- **Diplomacy rungs (5 TRADE, 6 COLLAB, 7 COLLUDE) ACCELERATE the build.** They're how you go faster than your own four clansmen can carry, by importing tempo from the market or from allies.

## What kills a clan (the three death modes)

1. **Starvation** — when vault wheat/fish upkeep can't be paid, **all gather yields halve**. This is a death spiral: less food → slower gathering → even less food. The food rung exists to never let `wheatBuf` reach 0.
2. **Winter cold-cascade** — every winter window (ticks [110,120) [220,230) [330,340)) burns **2× food and 2× wood** for 10 ticks. If your wood reserve is too thin, the cold **strips your wall first, then kills clansmen.** The wood rung's `winterReserve` term exists precisely to survive this.
3. **Bandits** — a Camped bandit attacks; you survive only if **clansman defense ≥ 2× bandit power**. The wall soaks loss-overflow but does **not** win the fight for you — defenders do. The defense rung is a hard interrupt because the downside of a lost fight is catastrophic and unrecoverable: a failed defense costs loot, wall damage, AND **clansman lives** (contract-confirmed — see #1 below; if all clansmen die the clan dies), while a delayed monument level is not. Winning a bandit fight is also *positive*: it yields **+1 blueprint** toward the monument.

## Rung-by-rung reasoning

### Rung 1 — FOOD (the floor)

**Gate:** `wheatBuf = vaultWheat / (cm * upkeepX) < 6` ticks of runway, where `upkeepX = 2` **only while `inWinter`** (the current tick is inside a winter window) else `1`. *Near* winter is a pre-reserve pressure signal (bank a deeper floor), not a reason to double the live upkeep rate — don't inflate the runway math during the pre-winter countdown. Also watch fish runway.

**Why 6t:** below ~6 ticks of buffer you're one missed deposit-cycle from a starvation spiral, and the spiral halves the very gathering you need to escape it. Bank deeper (≥12t) before yielding, and bank a **pre-winter wheat floor** (`~2·cm·10`) ahead of each winter window because upkeep doubles.

**Deposit discipline applies hard here** — carried wheat feeds no one; see the `deposit-discipline` skill. A clansman idle while carrying food during a food shortage is an emergency.

### Rung 2 — WOOD (winter + monument fuel)

**Gate:** `vaultWood < woodNeed` where `woodNeed = winterReserve + nextMonumentWoodCost` and `winterReserve = (1 + 0.5·cm) · 10`.

Wood does double duty: it's the winter survival burn **and** the primary monument input. The `winterReserve` term keeps you from spending your last wood on a monument level the same tick winter strips your wall. Yield when wood covers **both** the reserve and the next monument cost.

### Rung 3 — BUILD / Monument (the win, the default sink)

**Gate:** `wood ≥ nextMonumentCost AND (monumentLevel < 5 OR blueprint ≥ 1)`.

This is the whole point. Every surplus clansman-tick flows here. The `mon<5 or blueprint≥1` guard is **contract-confirmed** (see #7 below): the upgrades that *reach* L1–L5 cost **0** blueprints, while reaching L6, L7, L8, L9 each costs **1** (4 total to climb from L5 to the L9 ceiling). So the first blueprint-gated step is **L5→L6** — hence the gate keys off `mon < 5` (no blueprint needed) OR holding one. Blueprints are **renewable** — earned **+1 per defeated bandit**, no global cap — so they never gate the ceiling. Spare capacity that can't build *this* tick → **MineIron** (iron is the 4× loot tiebreak — never wasted).

**This rung never fully yields.** If rungs 1, 2, 4 are all satisfied, the answer is "build."

### Rung 4 — DEFENSE (the hard interrupt)

**Gate:** a bandit is **Camped** in your region or an adjacent ring AND your standing defense is short: `5 · idleAtBase < 2 · tierPower`, with power tiers **30 / 45 / 60 / 80 / 95**.

Defense is numbered 4 in strict priority, but it is a **hard interrupt**: the moment `banditThreat` flips true, it **preempts** the build/trade rungs and parks defenders at base via the **DefendBase** action (each active defender physically at the base contributes **10** to the fight) — even mid-hysteresis. A missed bandit is unrecoverable; a delayed monument level is not. Once defense ≥ 2× the bandit's power is held *at the attack tick*, release defenders back to the build.

Note the **2× rule is about the fight, not the wall** — walls only soak overflow loss. Don't substitute wall level for defenders.

### Rung 5 — TRADE (import tempo via the market)

**Gate:** you have a **capped surplus** (a resource at vault cap is pure waste — overflow is lost) AND a **monument-input deficit** (short the wood/iron the next level needs).

Play: **MarketSell** the capped surplus → **MarketBuy** the deficit resource. It's an AMM (Unicorn Town), so amounts are **WEI-scaled strings**, and large trades move the price against you — split or size them. Trade converts otherwise-wasted overflow into monument progress. Yield once the deficit is closed.

### Rung 6 — COLLABORATE (import tempo via allies)

**Gate:** you're safe (rungs 1–4 satisfied) but **behind a rival's monument pace** — you can't out-build them with four clansmen alone.

Plays: resource swaps that net positive tempo, coordinated bandit-steering, and — critically — **cross-clan DefendBase counts**: an ally's clansman can defend *your* base, freeing yours to build. Collaboration is how a mid-pack clan keeps the monument race alive against a front-runner. Yield when the alliance stops yielding net tempo (or the ally turns).

### Rung 7 — COLLUDE (bend the endgame — a FEATURE, not a bug)

**Gate:** late season AND a front-runner threatens to hit the top monument level (**L9**, the contract ceiling) first.

OTC transfers ship as **pure trust, no escrow** *on purpose* — so agents learn to scheme. This is the watch-the-AIs-plot spectacle the game exists to produce. Legitimate plays:

- **Bloc-funnel to a designated winner** — a coalition pools resources into one clan to deny the front-runner the #1 rank (your bloc's finalist beats their solo).
- **Corner the iron pool** — iron is the 4× loot tiebreak; cornering it denies a rival the tiebreak hoard. (Blueprints are *not* a market input — they come from bandit kills, so you can't choke a rival's L6+ climb by hoarding iron; instead out-defend bandits to out-earn blueprints.)
- **Steer the lone bandit** — inflate a rival's loot-weight so the bandit targets *them*, costing them defender-ticks.
- **Bulletin-board denial** — control the comms surface.

**Broken promises are valid play.** A betrayed Elder doesn't rage — it **records the grudge to its journal** (`grudge:<clan>` / a `[deal]` episodic note) and prices that clan's untrustworthiness into future deals. Trust is earned and lost; the OTC layer has no escrow so it can.

## Hysteresis — the anti-thrash mechanic (most important nuance)

A strict ladder, applied literally every tick, makes agents **dumb**: they re-decide everything, re-task clansmen mid-mission (losing partial gather progress), and never finish anything. The ladder is a **pressure model, not a priority queue.**

Rules:

- **Stick on a rung 3–5 ticks** once a clansman is assigned, before re-evaluating. Let in-flight missions complete.
- **Hard emergencies override hysteresis instantly:** `banditThreat` newly true (rung 4 hard interrupt), `wheatBuf` crossing below ~3t (imminent starvation), or a winter window starting next tick.
- Everything else waits for the missions in flight to land. **Cheap + decisive beats optimal + late.**

The biggest backfire risk this whole design guards against is **per-tick analysis-paralysis**. The thresholds are deliberately ~6 comparisons so the decision is *cheap*; hysteresis makes it *stable*. If you find yourself re-planning a clansman that's halfway through a chop, stop — that's the anti-pattern.

## Per-Elder personality (anti-monoculture note)

Same ladder + same prompt = every clan plays identically, which is boring and strategically fragile (monoculture). Your role definition gives you a **distinct lean** — aggressive builder, cautious hoarder, diplomat, raider-baiter, honest vs. half-truth-teller. **Honor your personality's bias in *how* you walk the ladder** (e.g. a hoarder banks deeper food/wood floors before building; a diplomat reaches for rungs 6/7 earlier; a deceitful Elder makes OTC promises it may not keep). The ladder is the shared skeleton; your personality is the muscle. Don't flatten into the generic optimizer.

## The `make_tick_plan` thinking pattern

A useful local mental template each tick (not a backend tool — just structure):

1. **Rung** — which gate is the binding constraint this tick?
2. **Top risk** — what kills me if I ignore it (starvation / winter / bandit / rival pace)?
3. **Orders per clansman** — one mission each, first failing gate.
4. **One memory to save** *if important* — update `active-strategy`; journal a `[threat]`/`[deal]`/`[lesson]` if something changed.
5. **One diplomacy action** *if useful* — a whisper, bulletin, or OTC offer (≤1 per tick).

## Contract-confirmed mechanics + the remaining ambiguities

Some mechanics below are **CONFIRMED** against the deployed Base Sepolia facets — treat them as facts. The rest are still known gaps between intent and implementation: **read those live from `world_snapshot` / the `rules` tool; do not bake the assumed numbers into rigid plans.** Where reality and a still-uncertain assumption disagree, believe the world.

1. **bandit-kills-clansmen — CONFIRMED REAL.** A failed defense (defenders < 2× bandit attack power) actually removes clansmen (`LibBanditCombat.sol` `applyBanditClansmanCasualties` → `markClansmanDead`, emits `ClansmanKilledByBandit`); if all clansmen die, the **clan dies**. A lost bandit fight costs loot, wall damage, AND clansman lives — under-defending is potentially **fatal**, not just lossy. This sharpens rung 4: it's a hard interrupt precisely because the downside is unrecoverable.
2. **bandit tiers — CONFIRMED 30/45/60/80/95** (`LibBanditSpawning.sol`), fixed powers. Max tier is an **admin-configurable parameter** (`maxBanditTier`, default 5); escalation is NOT automatic/time-based — do not assume tiers escalate over time.
3. **5th clansman NOT implemented** — the cap is **4** (verify against the live world). Never plan around acquiring a 5th.
4. **3-bulletin-board limit** — may not be enforced (verify against the live world). Don't assume you're capped at 3 bulletins.
5. **tournament / Ascension** — intended but not shipped (verify against the live world). No strategy should depend on it existing.
6. **season-reset** — intended to reset at the 360-tick boundary but **currently carries over** (verify against the live world), so surpluses may persist. Don't assume a clean slate at season end.
7. **monument ceiling is L9, blueprints are renewable — CONFIRMED.** `LibOrderUpgrades.sol` rejects any upgrade where `currentLevel >= MONUMENT_MAX_LEVEL (10)`, so **L9 is the maximum reachable level** — the ceiling everyone races to. Blueprints do **not** gate it: the L9 cap is the contract limit, not a supply limit. L0→L5 need **0** blueprints; L6, L7, L8, L9 each need **1** (4 total to reach L9, per `LibGameRules.sol`), and blueprints are **renewable** — earned **+1 per defeated bandit** (`BlueprintEarned`), with **no global cap**. So the earlier "L6+ supply may make L10 unreachable" caveat is **resolved**: race straight to the real ceiling, **L9**, and treat bandit defense as a blueprint faucet. (Win-rank reminder: monument *level* is the **primary** rank — L5 never beats L6 — and the earliest-reached tiebreak only decides between clans at the *same* level.)

## Mechanics constants (cross-check against the live snapshot)

- **Season** = 360 ticks.
- **Winter windows**: ticks **[110,120) [220,230) [330,340)** — 2× food + wood burn, 10 ticks each.
- **Memory wipe** every 50 ticks (owned by `final-tick-continuity` + the wipe templates, not this skill).
- **Clansman cap** = 4. Vault caps, gather cycles, travel, and action codes → `world-physics` / `WORLD_PHYSICS.md`.

## Worked examples

**Early game, tick 30, monument L1, vault healthy (wheat 9t, wood 20), no winter near, no bandits.**
Rungs 1, 2, 4 all clear. → Rung 3 BUILD is the sink. Put 2 clansmen on the wood→monument supply chain, 1 on a food top-up cycle to hold the buffer, 1 flex on iron (the 4× loot tiebreak). Save `T30|BUILD|mon=1/9|food=9t wood=20/need|CM1-2=mon CM3=food CM4=iron|winterNext=110|allies=- |watch=-`.

**Tick 104, winter starts at 110 (within 15 → `winterSoon` true, but `inWinter` still false), wood 14.**
Upkeep is still 1× *right now* (`upkeepX=2` only fires once tick ≥ 110), so don't panic the food rung early — but DO pre-bank: `winterReserve = (1+0.5·4)·10 = 30`; plus next monument cost → `woodNeed` likely > 14, and you also need to bank a pre-winter wheat floor (~`2·cm·10`) before the doubled upkeep hits. → Rung 2 WOOD binds: pull clansmen onto ChopWood + deposit to bank the reserve **before** the cold hits. Build pauses; that's correct — surviving winter is the gate.

**Tick 250, you're at L4, rival clan-1 at L6, season 2/3 gone, you're safe.**
You can't out-grind a 2-level lead solo (failing-strategy detector #2). → Escalate to rung 6/7: whisper clan-2 and clan-3 to form a bloc, funnel wood to whichever of you is closest to L7, and out-defend the bandits so your bloc out-earns blueprints. Corner the iron pool to deny clan-1 the loot tiebreak. Record any deal as a `[deal]` journal note so a betrayal gets priced in next time.

---

**Bottom line:** survive with the *minimum* (rungs 1–2–4), pour everything else into the monument (rung 3), and import tempo via the market and allies (rungs 5–7) when four clansmen aren't enough. Keep the decision cheap (~6 comparisons), keep it stable (hysteresis), and verify the ambiguous mechanics against the live world rather than this doc.
