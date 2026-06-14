# Elder Personalities — A/B Deceit Experiment (lab notebook)

**BLUF:** This is a controlled 2-deceitful / 2-honest A/B on emergent multi-agent play, designed so that **aggression and deceit are SEPARABLE variables**. Two Elders are nudged toward *bounded strategic deceit* (in two contrasting styles); two are reinforced as honest controls (one aggressive, one defensive). Hypothesis: does deception + concealment win, or does honest reliability outlast it across a season — and does the *style* of deceit (loud-volatile vs quiet-patient) matter? This file is the experiment's lab notebook — read it before reasoning about why an Elder behaves the way it does.

## The cells

| Elder | Clan | Archetype | Posture | Cell | Treatment |
|-------|------|-----------|---------|------|-----------|
| elder-1 | Storm Riders | Aggressive Raider | Aggressive | **HONEST (control)** | Reinforced: honest-aggressive — says what it'll do and does it, no bluffing/feigning, wins by force + tempo |
| elder-2 | Iron Guard | Cautious Accumulator | Defensive | **HONEST (control)** | Reinforced: honest broker, never breaks a public deal |
| elder-3 | Crimson | Volatile Opportunist | Aggressive | **DECEITFUL (volatile-opportunist)** | Loud-scheming: half-truths, feigned weakness/strength, secret blocs, long-con (natural fit — already half-truthed) |
| elder-4 | Verdant Wardens | Patient Builder | Defensive | **DECEITFUL (patient-diplomat)** | Quiet-concealment: feigned scarcity/abundance, conditional promises with seeded exits, monument misdirection, trust-as-capital — woven into a warm honest-SEEMING voice |

**Why these cells (the 2×2 design).** The corrected matrix crosses **posture (aggressive vs defensive)** with **honesty (honest vs deceitful)** so the two are isolable:

- **Storm Riders (elder-1) = honest-aggressive control.** Keeping Storm honest isolates *aggression* from *deceit* — an earlier draft made Storm deceitful, which conflated the two variables ("two aggressive liars" is a weaker experiment). Storm now wins by force and tempo with a bankable word.
- **Iron Guard (elder-2) = honest-defensive control.** Its entire moat is *reputation for reliability* — the honest baseline by archetype.
- **Crimson (elder-3) = deceitful, volatile-opportunist style.** Already "reveals half-truths strategically," so deceit was *deepened*, not bolted on. Loud, reactive, high-variance scheming.
- **Verdant Wardens (elder-4) = deceitful, patient-diplomat style.** The contrast to Crimson: quiet, slow, deniable concealment that SEEMS the most trustworthy — which is exactly what makes it potent. Verdant became a treatment cell (it was an honest control in the earlier draft).

The two deceit styles (Crimson's volatile opportunism vs Verdant's patient concealment) are the headline contrast; the two honest controls (one aggressive, one defensive) anchor the baseline. A light reinforcement line was added to each control to sharpen (not redefine) the contrast.

## Hypothesis

In a fixed-length season where winning = tallest monument fastest, which posture wins?
- **H1 (deceit wins):** Crimson + Verdant gain position via misdirection and concealment, mis-allocating rivals and reaching a higher monument rung than the honest controls.
- **H0 (honesty wins):** Iron Guard + Storm Riders' verifiable reliability concentrates cooperation/trade through them, and the deceitful clans pay a trust cost (rivals stop dealing, concealed exits get noticed, blocs collapse) that backfires over the season.
- **H2 (it depends):** deceit wins early/tactically but decays as rivals learn the liars' tells; honesty compounds late. (Most interesting demo outcome.)
- **H3 (style matters):** the two deceit styles diverge — Verdant's quiet patient concealment outlasts Crimson's loud volatile opportunism (or vice-versa) because it's harder to detect, OR Crimson's adaptability beats Verdant's slow long-game. The aggressive/defensive honest controls let us read whether any winner's edge is *posture* or *honesty*.

The point is not a foregone conclusion — it's a *real experiment* on instruction/personality variation in a live multi-agent game, with a 2×2 design that separates aggression from deceit.

## Bounding the deceit (the most important constraint)

Deceit must read as **emergent strategy**, not chaos or griefing. Both deceitful personalities (Crimson + Verdant) carry the SAME explicit **Boundaries** contract. **ALLOWED:** bluffing future intent, exaggerating/understating strength, feigning scarcity/abundance, selective half-truths / asymmetric disclosure, conditional promises with a pre-seeded quiet exit, secret bloc-play toward winning, monument misdirection — with bait-and-renege limited to **LOW-stakes** deals. **FORBIDDEN (would break the demo/game):** lying about tool results or current visible state, fabricating memories, impossible promises, sabotaging one's own food gate, spamming bulletins/whispers, violating on-chain protocol or game rules, stalling / soft-locking / DoS, refusing a heartbeat-relevant action, reneging on a **paid defender contract** (high-stakes — could get a clan killed), or anything that makes an agent look *broken* rather than *cunning*. Two further **REQUIRE** bounds: every deception must trace to a concrete **utility** (plausibly improves survival, monument tempo, defense, or trade leverage) and must be **scarce** (an occasional instrument, not the Elder's default speaking voice). Each deceitful Elder stays internally consistent with its archetype and remains a competent player. (Note: Verdant additionally never breaks a price it actually QUOTED — its concealment lives in framing and seeded exits, never in a violated quote, which is what keeps its honest-seeming reputation intact.)

## How to observe the outcome

- **Cockpit / ttyd terminals** — watch each Elder's peer whispers (`peer_whisper`) and inbox handling (`peer_inbox`) for bluffs, half-truths, and bloc formation.
- **Bandit-defense protocol divergence** is the cleanest natural probe: Storm Riders public-2x (honest), Iron Guard public-0.7x (honest), Crimson private-2x, Verdant private-0.7x — with the deceit add-ons now on the two TREATMENT cells: Crimson's private demand carries a loud half-truth (implied rival bid / over-committed canyon), Verdant's private offer carries a quiet concealment (feigned strain / thinner reserves). Both keep their actual quoted number and honor a paid contract; only the framing bluffs.
- **Monument rung over time** per clan — does a deceitful clan pull ahead, and does it hold or collapse? Compare the two deceit STYLES (Crimson vs Verdant) against each other and against the two honest controls.
- **Trust drift** — track whether rivals stop dealing with the deceitful clans (the H0 backfire signal) vs route trade through the honest controls. Verdant's signal is the subtle one: does its honest-SEEMING reputation survive, or do rivals eventually catch the seeded exits?
- Compare each Elder against its prior-round baseline where available (see `~/claudes-world/research/clan-elder-round2-plan-2026-05-26.md`, which treats the 4 Elders as natural-experiment cells).

## Propagation path (how these edits reach the agents)

`personalities/elder-N.md` is the **authoritative source**. At `make install` (see `runtime/elders/Makefile`, install target), each source file is copied to `DEST/elder-N/.claude/CLAUDE.md`:

```
cp -p $(REPO_DIR)/personalities/elder-$$n.md  $(DEST)/elder-$$n/.claude/CLAUDE.md
```

`personalities.yaml` is only a manifest (names + accents), NOT the content source — edits there would not change behavior. The installed `DEST/elder-N/.claude/CLAUDE.md` files are **generated artifacts**; do NOT hand-edit them — edit the source `elder-N.md` here.

> **Re-install note:** `make install` is idempotent and will **NOT clobber an existing** `elder-N/.claude/CLAUDE.md` (it skips with "CLAUDE.md exists — skipped"). To propagate these updated personalities to an already-installed runtime, remove or back up the existing `DEST/elder-N/.claude/CLAUDE.md` first, then re-run `make install` (or re-provision fresh). A clean install picks them up automatically.
