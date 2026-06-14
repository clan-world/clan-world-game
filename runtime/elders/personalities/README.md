# Elder Personalities — A/B Deceit Experiment (lab notebook)

**BLUF:** This is a controlled 2-deceitful / 2-honest A/B on emergent multi-agent play. Two Elders are nudged toward *bounded strategic deceit*; two are reinforced as honest controls. Hypothesis: does deception + collusion win, or does honest reliability outlast it across a season? This file is the experiment's lab notebook — read it before reasoning about why an Elder behaves the way it does.

## The cells

| Elder | Clan | Archetype | Cell | Treatment |
|-------|------|-----------|------|-----------|
| elder-1 | Storm Riders | Aggressive Raider | **DECEITFUL** | Bluffing, low-stakes bait-and-renege, monument misdirection, bloc-play |
| elder-2 | Iron Guard | Cautious Accumulator | HONEST (control) | Reinforced: honest broker, never breaks a public deal |
| elder-3 | Crimson | Volatile Opportunist | **DECEITFUL** | Half-truths, feigned weakness/strength, secret blocs, long-con (natural fit — already half-truthed) |
| elder-4 | Verdant Wardens | Patient Builder | HONEST (control) | Reinforced: honesty as competitive edge, discloses prices, keeps every public deal |

**Why these cells.** Crimson (elder-3) already "reveals half-truths strategically" — it's the natural deceit cell, so deceit was *deepened* rather than bolted on. Storm Riders (elder-1) are aggressive opportunists "willing to take a deal AND break it" — deception extends their raider identity cleanly. Iron Guard's entire moat is *reputation for reliability*, and Verdant is the realm's *trust pole* — they are the honest controls by archetype, so the contrast is crisp without rewriting them. A light one-line honesty-as-strategy reinforcement was added to each control to sharpen (not redefine) the contrast.

## Hypothesis

In a fixed-length season where winning = tallest monument fastest, which posture wins?
- **H1 (deceit wins):** Crimson + Storm Riders gain position via misdirection and collusion, mis-allocating rivals and reaching a higher monument rung.
- **H0 (honesty wins):** Iron Guard + Verdant's verifiable reliability concentrates cooperation/trade through them, and the deceitful clans pay a trust cost (rivals stop dealing, blocs collapse) that backfires over the season.
- **H2 (it depends):** deceit wins early/tactically but decays as rivals learn the liars' tells; honesty compounds late. (Most interesting demo outcome.)

The point is not a foregone conclusion — it's a *real experiment* on instruction/personality variation in a live multi-agent game.

## Bounding the deceit (the most important constraint)

Deceit must read as **emergent strategy**, not chaos or griefing. The two deceitful personalities each carry an explicit **Boundaries** clause. Permitted: bluffing resources/strength, selective half-truths in negotiation, feigned weakness/strength, bait-and-renege on **LOW-stakes** deals only, collusion/bloc-play toward winning, monument misdirection. **Forbidden (would break the demo/game):** spamming bulletins/whispers, violating on-chain protocol or game rules, stalling / soft-locking / DoS, reneging on a **paid defender contract** (high-stakes — could get a clan killed), or anything that makes an agent look *broken* rather than *cunning*. Each deceitful Elder must stay internally consistent with its archetype and remain a competent player; every deception must trace to a concrete positional gain.

## How to observe the outcome

- **Cockpit / ttyd terminals** — watch each Elder's peer whispers (`peer_whisper`) and inbox handling (`peer_inbox`) for bluffs, half-truths, and bloc formation.
- **Bandit-defense protocol divergence** is the cleanest natural probe: Storm Riders public-2x, Iron Guard public-0.7x, Crimson private-2x, Verdant private-0.7x — now overlaid with the deceit add-ons (bluffed reserves / implied rival bids) on the two treatment cells.
- **Monument rung over time** per clan — does a deceitful clan pull ahead, and does it hold or collapse?
- **Trust drift** — track whether rivals stop dealing with the deceitful clans (the H0 backfire signal) vs route trade through the honest controls.
- Compare each Elder against its prior-round baseline where available (see `~/claudes-world/research/clan-elder-round2-plan-2026-05-26.md`, which treats the 4 Elders as natural-experiment cells).

## Propagation path (how these edits reach the agents)

`personalities/elder-N.md` is the **authoritative source**. At `make install` (see `runtime/elders/Makefile`, install target), each source file is copied to `DEST/elder-N/.claude/CLAUDE.md`:

```
cp -p $(REPO_DIR)/personalities/elder-$$n.md  $(DEST)/elder-$$n/.claude/CLAUDE.md
```

`personalities.yaml` is only a manifest (names + accents), NOT the content source — edits there would not change behavior. The installed `DEST/elder-N/.claude/CLAUDE.md` files are **generated artifacts**; do NOT hand-edit them — edit the source `elder-N.md` here.

> **Re-install note:** `make install` is idempotent and will **NOT clobber an existing** `elder-N/.claude/CLAUDE.md` (it skips with "CLAUDE.md exists — skipped"). To propagate these updated personalities to an already-installed runtime, remove or back up the existing `DEST/elder-N/.claude/CLAUDE.md` first, then re-run `make install` (or re-provision fresh). A clean install picks them up automatically.
