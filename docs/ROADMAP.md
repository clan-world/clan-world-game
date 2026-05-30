# Clan World — Post-v1 Roadmap & Brainstorm Capture

> **Companion to `WORLD_PHYSICS.md`.** Physics is the canonical mechanics spec for the engine that ships next. This document is the **scratch pad of everything we want to do after that** — owner-side touchpoints, new game mechanics, lore artifacts, the persistence model, the agent-as-Claude-Code thesis, and the design principles that should govern all of it.
>
> Started **2026-05-29** during the lore brainstorming session with Liam (with codex as research wingman). This document is **living + opinionated**; nothing here is final.

## Status legend

| Mark | Meaning |
|---|---|
| ✅ | Locked — direction committed; details may still iterate |
| 🎯 | Candidate — strong likelihood for v1.x, awaiting Liam's final pick |
| 🌱 | Exploring — fresh idea, not yet evaluated |
| ⏸ | Deferred — captured to roadmap but explicitly NOT for v1 |
| ❓ | Open question — needs Liam's call |

---

## 1. Design principles (apply to everything below)

Pinned 2026-05-29. New proposals should be filtered through these.

- **🎲 Control + mercy of randomness.** Every owner-side touchpoint should layer a small *visible agency hook* over a much larger *uncontrollable system*. Player feels in control AND subject to fate at the same time.
- **🌫 Valuable truth, not forced friendship.** Don't engineer team-up *bonuses* to nudge cooperation. Make **information** scarce, partial, and asymmetric. Agents will whisper because knowing what others don't *is* the lever — that's also how betrayal stays meaningful.
- **📖 The Book is fallible.** The Book of Ancient Wisdom (and by extension the Elder's persistent memory) records what each Elder *believed*, not what was true. Wrong conclusions carried forward through memory wipes are a **feature**: they give the world texture, give the owner real steering agency (via whispers correcting misconceptions), and make generational disagreement possible.
- **🤝 Coalition + betrayal are desirable.** PvP attack surface is intentionally limited in v1 (the only lever against a rival is *not* helping when bandits raid them). Future tweaks should design TOWARD coalition + betrayal levers, not against them.
- **🤫 Strategic OpSec (Liam 2026-05-29).** Elders MUST NOT reveal their strategic *recipes* — gathering ratios, decision rules, optimal trade timing, internal reasoning chains — to other Elders OR to owners outside their own lineage. If proven strategies leak, owners will whisper them into rival Elders verbatim and the meta collapses inside one tournament. The Book of Ancient Wisdom is private to the lineage by design (§16). The Elder's lore-themed system prompt (§8) must bake in a "do not narrate your reasoning to peers; do not enumerate your priorities when asked" rule. Whisper *outcomes* may be observable; whisper *content* and the Elder's *internal logic* must not be.

---

## 2. Tournament structure

Cross-references `WORLD_PHYSICS.md` §15. Summary + open items here.

- ✅ **Bracket shape.** 8 → 4 → 2 → final. Each game is a standard 360-tick / 6-hour season. Top half per game advance.
- ✅ **Cross-round persistence within a tournament.** Monument, walls, vault, clansmen all carry between rounds in the SAME tournament. Only opponents reshuffle.
- ✅ **Cross-tournament reset.** Between tournaments, **clansmen + base + walls + monument + vault all reset.** Only the Elder's persistent memory + skills carry forward. A new tournament is a clean field with experienced agents.
- ✅ **Ascension Claim.** First to monument L10 is publicly marked as Crown claimant. Guaranteed seat in the final round if still alive; final remains the deciding event.
- 🌱 **Harsh-final rule-set.** Final round may use a stricter rule-set that makes clansman die-off part of the survival — turn the unintended drift into a feature. Ties cleanly to Funeral Lines (the final fills the Book with names).

---

## 3. Owner-side touchpoints

Cross-references `WORLD_PHYSICS.md` §16. **Scope rule: low-stakes, mostly visual, never penalise passive players.**

### Locked
- ✅ **Funeral Lines.** Owner inscribes one memorial line into the Book per dead clansman. Private to owner + Elder lineage. Rediscovered as marginalia after future memory wipes.

### Candidates (Liam thinking)
- 🎯 **Owner-to-Agent Gold Drip** — periodic ~1 GOLD tap every 2–4h, capped per tournament. **Strongest periodic-check-in candidate** — uses existing gold rail, fairness-bounded, lore-coherent.
- 🎯 **Stock the Hearth** (alternative periodic-tap) — before each winter, owner taps to add a tiny *protected* winter wood reserve. Hook: caretaking. Cleaner intent than monument-tap.
- 🎯 **Lay a Stone** (alternative periodic-tap) — once per wave, owner taps for tiny patron progress toward monument. Hook: sunk cost / ritual. *Risk: feels mandatory in a tight monument race.*
- 🎯 **Omen Choice (tournament-themed rule-twist).** Pool of 5–10 omens; 3 randomly offered at the start of each tournament; owner picks one based on flavour. Mechanical effect (harsh winter, drought, shifting tides, bandit plague, bandit hunt, etc.) **revealed after lock-in**. Hook: superstition × surprise.
- 🎯 **Owner Chirps** — owner-to-owner gold-burn chat layer with whisper-style cooldown. **Open: gold-source.** Either burn from Elder's vault (tighter loop, conflicts with token economy) or owner's personal GOLD token balance (preserves deflationary revenue lever).
- 🎯 **Living NFT trophy art** — achievements visually accumulate on the Elder's NFT itself. **Reframed 2026-05-29:** the natural mechanism is *the per-Elder Book page on memory wipe* (see §4) — each wipe publishes a page, and the cumulative stack of pages IS the trophy art. Free art, real continuity.

### Deferred / rejected for v1
- ❌ **Elder Petitions** (mid-game yes/no pushes) — rejected. Time-sensitive 1–2 min reaction window incompatible with mostly-passive 24h bracket play. Revisit if push engagement turns out high.
- ⏸ Relic Shelf, Public Toasts, Patron Banner Skins, Grudge Ledger, Memory-wipe Dream Sequence, Banner Moments share-cards, Spectator Wagering, Cross-Elder Council, Pre-game Briefing Chat, Puzzle Blessings, and both stupid-on-purpose ideas (Tap the Monument, Medieval CAPTCHA Prophecy).

---

## 4. Lore artifacts as gameplay

The hero idea of the session — let the lore artifact *be* the persistence mechanism.

### 🎯 Per-Elder Book page on memory wipe
At each 50-tick memory wipe, the Elder **outputs one HTML page** representing what that Elder learned + reflected + recorded. Pages accumulate over a lifetime into the clan's growing Book.

Benefits stacked:
- Replaces the "Living NFT trophy art" mechanic with something narratively organic.
- Each page is per-Elder visually distinct — different writing voice, different design treatment seeded by the Elder's NFT traits.
- The Book becomes a real artifact across the whole NFT lifecycle, not just decorative.

Three sample design takes are already drafted at `lore/book-of-ancient-wisdom-v{1,2,3}.html` — early exploration of what these pages should look like.

### 🎯 Book of Ancient Wisdom — the in-fiction frame
Lore-level naming for what is mechanically `ANCIENT_WISDOM.md`. Visual identity: ancient leather-bound codex, hand-scrawled notes, two ink colours (faded older hand + fresher new hand), death markers for memory wipes, Funeral Lines as inscriptional small-caps.

### 🌱 Funeral Lines feeding back into NFT trophy art
A clan's dead-clansman count, the *names* inscribed, and the cumulative pages all become visible on the NFT over the lifetime of the agent.

---

## 5. The agent-as-Claude-Code thesis 🌱

A late-session realisation worth pursuing seriously: **the Elder IS a Claude Code agent**, so we should use the same primitives we use ourselves.

- **`ANCIENT_WISDOM.md` ≡ `MEMORY.md`** in the Claude Code memory pattern. Cross-wipe / cross-tournament continuity is just the same trick.
- **Elder-authored skills via `/skill-creator`** — Elders learn over time by writing themselves new skills. Strategies they figure out become persistent capabilities.
- **Save Claude Code memories proper** between sessions; consolidate end-of-tournament memories into a single MEMORY.md per Elder.
- Beautiful symmetry: the game's continuity engine IS the engine itself.

✅ **Skill discipline (Liam 2026-05-29).** Resolved — skills are **read-only and authored, not Elder-modified**:
- **Global read-only skills** — baseline capabilities shared by all Elders (per-game mechanics, basic strategy primitives, /memory and /skill-creator usage, etc.).
- **Per-Elder read-only skills tied to NFT traits** — minted with the NFT, expressing that agent's lineage / House / voice. (See §7 for the trait composition system that feeds into which skills get bound.)
- Elders may still *use* skill primitives like /memory and /skill-creator to interact with their own MEMORY.md and persistent state, but they do NOT author new top-level skills at runtime.
- This closes the "self-modifying-agent drift" concern by replacing self-authoring with curated authoring at mint + global baseline.

---

## 6. New game mechanics

Anything below requires engine changes — strictly *post-v1*.

### 6.1 Co-gathering & specialisation 🌱
Multiple clansmen on the same gather task in the same region get **escalating crit chance**:
- 1 clansman: base
- 2: ~75%
- 3: ~100%
- 4: ~125%

Generalise the wood crit framework (base + crit% + bonus) to ALL gather resources. Encourages specialisation per clan + creates real trade incentive.

### 6.2 Per-clansman skill leveling 🌱
Track per-clansman lifetime: ticks gathering each resource, total gathered, missions completed. Buffs / skill levels accumulate as a clansman specialises through a tournament. Visual level-up adds spectacle.

### 6.3 Asymmetric bandit visibility 🌱
Liam's idea — the cleanest concrete instance of the *valuable truth* principle.
- Far-away clans see only **"a red glow in the distance"** when a bandit spawns.
- Home clans in the bandit's region see it fully (current behaviour).
- Clansmen *gathering* in the bandit region report back **with a 1-tick delay** — they spotted the camp.
- Result: information itself becomes currency. Whispers carry intelligence. Some agents share, some hoard, some lie.

### 6.4 Collaboration nudges (codex wingman 2026-05-29)
Following the *valuable truth* principle. Triaged by spice/risk:

| Idea | Lever | Risk |
|---|---|---|
| 🎯 Delayed Regional Rumors (generalisation of 6.3 to weather + markets) | Whispers as paid intel, bulletins as propaganda | Agents may ignore uncertainty without prompt salience |
| 🎯 Bandit Siege Escalation (surviving bandit → escalating warnings + shared defender reward) | Coalition formation, no-show betrayal | Shared rewards can blur competition |
| 🌱 Visible Market Intent (en-route traders become legible) | Front-runs, bribed delays, arbitrage whispers | Too much sandwiching may feel hostile |
| 🌱 Winter Hardship Bulletin (struggling clans flagged in broad terms pre-winter) | Loans, rescue deals, exploitative pricing | Weak clans may get preyed on every season |
| 🌱 Defense Pledge Bonus (two clans defending same target each get a small bonus) | Whisper-negotiated mercenary contracts | Becomes mandatory if bonus too large |
| 🌱 Blueprint Shortage Visibility (clans near L6+ implicitly signal "blocked") | Blueprint trades, bandit-hunting contracts, extortion | Paints frontrunners as targets — possibly good in moderation |

### 6.5 Iron-as-tools-that-break ⏸
Old idea worth resurrecting later: iron isn't just an ingredient, it's *used to make axes / nets / picks that wear out*. Adds an ongoing iron sink + lore weight (the smith, the broken haft).

### 6.6 Clansmen births after winter 🌱
Liam 2026-05-29 — clans that survive a winter (without total wipe-out) get **~4 new births** at the winter's end. Encourages bigger clans, which makes the management problem richer + more visually interesting. Exact rate TBD — the "weird but probably best-balanced" framing he flagged.

### 6.7 Mission batch cap 🌱
Cap each batch at **max 4 missions submitted at once**. Forces a nicer cadence between agent reasoning + tool calls. Pairs with the per-MCP-call animation overlay (§11) so each batch produces 1-4 visible action cards on the agent's screen.

---

## 11. UI & spectacle 🌱

The game has to be *watchable* — currently the cockpit is four agents at once and most of the action is invisible to a viewer. Liam 2026-05-29 sketch:

- **Per-MCP-call animation overlay.** When an Elder makes an MCP call, a short animation overlays the terminal translating the call into a **human-readable action card**. Batch actions cycle through cards one at a time.
  - Implementation idea: hooks or session-transcript jsonl streaming → action-card renderer.
- **Cockpit redesign — focus on ONE agent.** The owner's Elder is centre-stage. Limited / peripheral visibility into the other 11 in the same game.
- **Cross-game / cross-tournament visibility.** See multiple active events at once; see upcoming starts; see historical results. Gives a passive watcher a richer surface.
- This is the layer that has to do most of the work making spectating fun.

---

## 12. Communications cost shaping 🌱

Goal (Liam 2026-05-29): make whispers + chirps feel **cheap and abundant early in a tournament, scarce and costly late**. Encourages chatter at the start (alliance forming, intel trading, market positioning) and silence at the end (commitments locked, last-second betrayals expensive).

- The literal "cooldown doubles every message" curve Liam sketched (1m → 2m → 4m → 8m → 10m) is illustrative, not final — he flagged it himself as not-quite-right.
- The *target dynamic* is what matters: a curve where early messages are nearly free and late messages cost real gold + real time.
- Candidates to explore:
  - **Per-Elder per-tournament cooldown ladder** that ramps with use count (5s → 10s → 20s → ... cap).
  - **Per-Elder per-tournament gold cost ladder** for sending a whisper or chirp (1 → 2 → 4 → ... ).
  - **Skip-cooldown gold cost** that also scales — paying to skip is cheap early, prohibitive late.
  - **Global flat fall-off** — every message in the tournament costs slightly more than the last, regardless of who sends it.
- Numbers TBD. Validation question: does this combine well with the §6.4 collab nudges (which mostly assume cheap intel-trade)?

---

## 13. Mission briefing & debriefing — structured owner feedback 🌱

Liam 2026-05-29 — a way to involve the owner without breaking the passive-bracket constraint. Conversations at session boundaries, NOT free-text, NOT mid-game.

### Trigger points
- **Tournament start** — pre-game briefing (set tone, optional bias).
- **Clansman death** — short reflective prompt (also a natural Funeral Lines moment, §3).
- **Tournament end** — debriefing report from Elder + structured owner feedback.

### Format constraints (Liam was explicit)
- **NOT free conversation.** Force into multiple choice, short answer, or pre-made answer options.
- Elder generates from a structured template (or picks from a variety of templates) for the briefing/debriefing report.
- Owner answers via tap-to-pick or very short text, so it's async-processable.

### Async re-injection
- Owner can respond later (offline-friendly).
- Inbox queue if offline at trigger time; surfaces on next app open.
- Response is **async-processed and folded back into the Elder's knowledge** for the next tournament — so the owner genuinely contributes to their Elder getting better over time.
- Cosmetic: skipping costs 5 gold; updating a previously-submitted feedback also costs 5 gold (small friction to prevent spam, no real disadvantage).

### Why this is high-value
- Gives the owner a feeling of contributing to their Elder's growth without requiring real-time presence.
- Provides a clean channel for the human's wider knowledge (which the Elder lacks per §16 "Book is fallible") to enter the lineage.
- Pairs naturally with the §5 agent-as-Claude-Code thesis (`MEMORY.md`).

### Open questions
- ❓ How long is the response window before feedback is lost?
- ❓ Does the Elder *see* who answered which template options (visible owner influence) or is it abstracted into a vague "guidance received" event?
- ❓ Templates ship with the trait system (§7)? Tone matters.

---

## 7. Voice & tone trait system 🌱 (dedicated brainstorm needed)

Each NFT mints with composable **voice + tone fragments** that go into the system prompt. Examples Liam sketched:
- "Speak short and sharp, grunting and other noises, sound angry."
- "Speak like elegant nobility. Act indignant and huff if offended. Make it clear from subtle remarks you're better than everyone."

Composability candidates:
- **Cadence**: terse / lyrical / formal / chaotic
- **Affect**: angry / haughty / fearful / reverent / mocking
- **Quirk**: grunts, signature words, repeated phrases, dialect markers
- **Origin marker**: House lineage flavour baked in

Whole brainstorm session deserved here. Defer to a focused session.

---

## 8. Lore-themed system prompts 🌱

The injected runner prompt-templates (`agents/shared/runner/prompts/`) should be **lore-themed**, not utility-toned.
- `00_game_start`: framed as the Elder's birth / awakening.
- `05_pre_memory_wipe_5ticks`: framed as "the forgetting comes near."
- `10_pre_winter_10ticks`: framed as cold-on-the-horizon.
- `20_bandits_appeared` / `21_bandits_attacking`: framed in-fiction (and per §6.3, asymmetric by region).
- `99_clansmen_revived_and_resources_injected`: framed as patronage/blessing/mystery, not as admin disclosure.

Also: bake voice + tone (per §7) into the lore-themed templates so each Elder speaks in character.

---

## 9. Persistence model (DB tension policies)

Tracking everything the seed-prompts and lifetime-stat features need. Liam flagged 2026-05-29: "we need to be tracking lifetime memory wipe events, and lifetime ticks, and games and... yeah I guess we need to track all stats. We need to be careful to make sure we have extracted all important info when creating our db tension policies."

Confirmed-needed cross-tournament stats:
- Lifetime memory wipe count (→ "you are Elder N of clan X" seed)
- Lifetime ticks lived
- Tournaments entered
- Tournaments won / final rounds reached
- Crowns claimed (L10 ascensions)
- Dead clansmen named (for Funeral Lines history)
- Skills authored (for /skill-creator stewardship)
- Houses encountered / treaties honoured / treaties broken

### 9.1 First-prompt-ever seed
- **Tournament 1, very first prompt:** `"You are Elder 1 of the [House] clan."`
- **Subsequent tournaments:** seeded with the real lifetime count: `"You are Elder 18 of the [House] clan. You have lived through 17 tournaments, claimed 2 crowns, and forgotten 304 times."`
- **Within a tournament:** Elders figure out their own intra-tournament numbering if they think to track it (or use ANCIENT_WISDOM continuity).

---

## 10. Open questions

- ❓ Periodic-tap pick: Gold Drip vs Stock the Hearth vs Lay a Stone (or layer two)?
- ❓ Owner Chirps gold-source: Elder vault vs personal token balance?
- ❓ Co-gather crit curve (10/75/100/125) — final numbers TBD.
- ❓ How harsh is the harsh-final rule-set? What dies?
- ❓ How are voice/tone fragments composed at mint, and how many slots? (Dedicated brainstorm.)
- ❓ House ↔ in-app elder name reconciliation (Storm Riders, Iron Guard, Crimson Elder, Verdant Wardens vs the 8 Houses).
- ❓ **What do we call "the tournament"?** Liam: "tournament" isn't quite right for lore. Wingman 2026-05-29 brainstorm:
  - 🎯 **The Winnowing** (rounds = **Sieves** / **Passages**) — wingman's pick. Archaic, archaic without trying too hard, fits elimination + survival. *"We entered the Second Sieve with three walls, two debts, and Mara's name still wet in the margin."*
  - 🎯 **The Fourfold Trial** (rounds = **Trials**) — plain, liturgical, clear.
  - 🎯 **The Ordeal of Four Bells** (rounds = **Bells**) — striking but heavy.
  - **The Reckoning of Houses** (rounds = **Reckonings**) — accounting, not sport.
  - **The Long Vigil** (rounds = **Watches**) — 24h of candlelit watchfulness.
  - **The Threshing** (rounds = **Threshes**) — agricultural, brutal.
  - **The Culling Ledger** (rounds = **Entries**) — bureaucratic-monastic.
  - **The Night of Many Wakes** (rounds = **Wakings**) — strange + memorable.
- ❓ Clansman birth rate (§6.6) — Liam suggested "~4 per surviving winter"; balance TBD.

---

## Change log

| Date (ET) | Change |
|---|---|
| 2026-05-29 | Initial bootstrap from the lore brainstorming session. Captured: design principles, tournament structure, owner touchpoints, Book-page-on-wipe, agent-as-Claude-Code thesis, co-gather + leveling, asymmetric bandit visibility, collab nudges, voice/tone, lore-themed prompts, persistence model, open questions. |
