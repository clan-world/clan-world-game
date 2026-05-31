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

## 5. Agent harness & continuity layer 🌱

The Elder is **harness-and-model-portable** — must be able to run under Claude Code AND under other harnesses (Pi, Codex, OpenCode, etc.). Liam 2026-05-29 update: *"need to make the system able to use another harness like pi or codex or open code pretty soon, so probably shouldn't incorporate claude code memories at least not right away."*

So while the Claude-Code primitives are conceptually elegant, the implementation must NOT depend on them specifically. Map them to a portable abstraction:

| Conceptual primitive | Mapped to (portable) |
|---|---|
| `ANCIENT_WISDOM.md` / Book of Ancient Wisdom | One canonical persistent markdown file per Elder lineage, harness-neutral |
| Elder-authored skills via `/skill-creator` | Per-Elder skill *registry* (markdown + metadata), Elder-readable in any harness |
| Claude Code "memories" auto-saves | Defer — implement only after the harness-neutral memory file works across all supported harnesses |
| `/memory` / `/skill-creator` UX | Re-implemented as game CLI verbs the Elder calls, harness-agnostic |

- ✅ **Self-authored skill encouragement schedule** (from prior session): optional before memory wipes; strongly encouraged at end of game; never silent.
- ✅ **Cross-tournament memory disambiguation**: at the start of a new tournament, the Elder is prompted that any memories/skills predating this checkpoint are from past tournaments and may not match current world state.
- ✅ **Harness + model is part of the NFT roll** (Liam 2026-05-29). Different Elders use different LLM substrates — see §14 below.
- The original beautiful symmetry (game continuity engine = the development engine) still holds in spirit, just abstracted into a portable layer.

✅ **Skill architecture (Liam 2026-05-29 — REVISED twice in session, this is the consolidated answer):**

Two layers of skills are baked in at mint and at runtime:
1. **Global read-only skills** — baseline capabilities shared by all Elders (per-game mechanics, basic strategy primitives, /memory + /skill-creator usage, etc.). Curated by us, not edited by Elders.
2. **Per-Elder read-only skills tied to NFT traits** — minted with the NFT, expressing lineage / House / voice. (See §7 for the trait composition system.) Curated at mint, not edited at runtime.

PLUS **Elders MAY author + edit their own skills at runtime**, which was the original primary memory surface intent:
- **Encouragement schedule (Liam 2026-05-29):**
  - **Optional** before each memory wipe — a gentle nudge to capture anything useful.
  - **Strongly encouraged but not forced** at the end of each game — they may have learned nothing worth keeping, so don't over-prompt and pollute their skill set.
  - **Not silently auto-triggered** — must come from a structured checkpoint prompt the Elder can decline.
- Elders also save **Claude Code memories proper** through their session and at end-of-tournament these get consolidated into the Elder's MEMORY.md / ANCIENT_WISDOM.md.

🆕 **Cross-tournament memory disambiguation (Liam 2026-05-29).** Any persistent memory carried from PRIOR tournaments must be **flagged as past-tournament** when surfaced into the Elder's working context. At the start of a new tournament, an early prompt reminds the Elder: *"Any memories or skills predating this checkpoint were authored in past tournaments. They may not match the current world state. Trust them only as far as your own eyes have walked"* (echoing the Book's First Rule). This prevents the Elder from confusing past-game observations with current-game state.

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

- **Per-MCP-call action cards over the MAP** (Liam 2026-05-29, revised from terminal overlay). The cards do NOT overlay the terminal — they overlay the **map portion of the cockpit** (mobile-first design). Toggleable on/off (or possibly a fully separate view) so the player can choose between watching raw agent reasoning and watching the dramatised action.
  - Each card translates one MCP tool call into human-readable language with icons + sprites: *"two clansmen to the forest,"* *"deposit at base,"* *"defend west docks."*
  - Batched MCP calls (up to 4 per submit per §6.7) cycle through cards one at a time.
  - **Unified Elder art:** the visual anchor of each card is a static piece of Elder art — same art as the NFT. Generated at mint via ChatGPT ImageGen from prompt-fragments assembled from the Elder's traits (House, voice, lineage, etc.), producing consistent art across the whole product surface (NFT, cockpit, action cards, map overlay).
  - Liam explicitly flagged this as **near-term shippable**, NOT scope creep — the static art + card-renderer pipeline is small and looks much better than raw logs.
  - Implementation: hooks or session-transcript jsonl → MCP-call extractor → card renderer drawing on a sprite/icon library + the Elder's mint-time art.
- **Cockpit redesign — focus on ONE agent.** The owner's Elder is centre-stage. Limited / peripheral visibility into the other 11 in the same game.
- **Cross-game / cross-tournament visibility.** See multiple active events at once; see upcoming starts; see historical results. Gives a passive watcher a richer surface.
- This is the layer that has to do most of the work making spectating fun.

### 11.1 Day/night cycle (revisit) 🌱

Previously implemented, visuals glitched, turned off. Liam 2026-05-29 wants to revisit.
- Original plan was a per-tick day/night which "wouldn't look good" at the 60s heartbeat.
- **New idea:** **night mode syncs with the device clock** of the watching owner — owner watching at midnight sees the cockpit and map rendered in nightmode regardless of in-game tick. Decouples visual day/night from game-tick timescale entirely.
- Lower risk (no engine-state coupling), higher reward (atmosphere matches when the owner is actually watching).
- Pure presentation layer; cheap to ship.

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

## 14. Rarity, ranking, lifecycle 🌱

Liam 2026-05-29 — a coherent rarity/sink/upgrade engine for the NFT economy. **Strongly tied to NFT scarcity + demand.**

### 14.1 Mint random-roll axes (Liam 2026-05-29, expanded)

Each minted Elder rolls along several axes — together they determine compute substrate, capability set, and starting personality. Anchored to §5's portable continuity layer so model/harness can vary per Elder without breaking continuity.

| Axis | Examples | Rarity role |
|---|---|---|
| **Harness** | Claude Code, Pi, Codex, OpenCode | Less rarity-driving than model; mostly compatibility |
| **Model** | (see tier table below) | Single biggest rarity axis |
| **Thinking level** | low / medium / high / xhigh | Independent rarity multiplier — xhigh on a top model is double-rare |
| **Skill set** | global read-only base + 0–N rolled rare skills | Determines starting capabilities (e.g. trust-ledger skill — see §14.7) |
| **House** | Crimson, Cobalt, Aurum, Verdant, Violet, Ember, Pale, Slate | Art / personality / lineage |
| **Voice fragments** | cadence × affect × quirk × origin (see §7) | Tonal differentiation |

#### Model tier ladder (Liam 2026-05-29)

| Tier | Models | Notes |
|---|---|---|
| **Common** | Cheap Chinese models (Qwen, DeepSeek, etc.), Claude Haiku, GPT-mini | Needs an R&D project soon to evaluate which Chinese models hold up in agent role (see §16) |
| **Mid** | Mid-tier frontier models, older Claude / GPT versions | TBD |
| **Rare** | Sonnet-4.5, Sonnet-4.6, GPT-5.4, GPT-5.5 | The current scarce tier |
| **Pinned / vintage** | Older models that were once mintable but are now pinned (no longer in rolling pool) | Stays available for existing NFTs; rarity grows over time |

When new frontier models drop, that's a **big release event**: new models enter the rolling pool, oldest tier of previously-available models get **pinned** (removed from new rolls but preserved on existing NFTs as "vintage").

#### Version-bump on merge (Liam 2026-05-29)

During the §14.3 three-agent merge, there's a **small probability of a version bump** — a chance to upgrade your model tier on merge. Adds an "engagement reward" to the merge mechanic beyond just trait consolidation, and gives owners a path to climb tiers without depending on fresh mints alone.

### 14.2 Ranking system
A skill / record / win-rate based ranking layer atop the NFT registry. Surfaces who's actually winning. Drives matchmaking (eventually), market signaling, and the rarity-tier visibility on the cockpit + NFT trophy art (§4).

### 14.3 Three-agent merge mechanic
You can **merge 3 Elder NFTs into 1**. A dedicated **optimizer agent** combines the factually-correct parts of their pooled knowledge (skills + ANCIENT_WISDOM contents), cleans out mistakes/contradictions, and produces one resulting Elder with a consolidated lineage.

- **Random outcome by default** — the merge produces a new Elder with a stochastically rolled (harness, model) + trait blend. The optimizer agent's job is the KNOWLEDGE merge; the new physical NFT is a fresh roll.
- 🎯 **3-of-a-kind = guaranteed outcome.** Merging 3 NFTs of the same House (or same harness+model, or other matching axis TBD) gives a deterministic upgrade — guarantees the resulting Elder retains the matched trait/lineage. Mirrors the rarity-tier merging convention from collectible games.
- The optimizer-agent step is itself a sub-product — operates on the Book of Ancient Wisdom + the skill registry, surfaces contradictions to the player before committing.

### 14.4 Burn-and-reroll alternative
If you have 3 *dud* Elders you don't want to combine, you can **burn all 3 for a fresh single Elder roll**. Clean economic sink. No optimizer-merge — just sacrifice for a new chance.

### 14.5 Why this matters
- **Sink** for low-tier NFTs (burn-and-reroll).
- **Upgrade path** for committed owners (3-merge).
- **Rarity preservation** via 3-of-a-kind guarantees.
- **Demand floor** because every player needs >1 Elder to access the merge/burn mechanics.
- Aligns with the larger "make NFT economy real" goal.

### 14.6 Open design
- ❓ What exactly does "matching" mean for 3-of-a-kind? Same House? Same (harness, model)? Same voice fragment? Same lineage depth?
- ❓ Does the optimizer agent's knowledge-merge produce visible diff/changelog the owner can review before committing the merge?
- ❓ What carries through the burn-reroll? Nothing? A small Crown-claim history bonus? Lifetime stats?
- ❓ Cooldown between merges/burns to prevent rapid-fire reroll spamming?
- ❓ Version-bump probability curve on merge — flat 5%? Higher if all 3 inputs are top-tier? Per-axis bumps (model can bump, thinking can bump, harness can bump independently)?

### 14.7 Trust ledger as a rare rolled skill (Liam 2026-05-29)

A **read-only skill** that some (not all) Elder NFTs roll at mint, granting the capability to maintain a **persistent directory of clan IDs** they've encountered across tournaments. The skill itself is non-editable; the *data* it manages is writable.

What an Elder with this skill can do:
- Record observations: "Clan 0x4a2 was trustworthy in three deals; Clan 0x71f reneged on a wheat trade in season 7."
- Query the ledger when whispering or being whispered at: "Have I dealt with this clan before? What did I conclude about them?"
- Carry the ledger across memory wipes and across tournaments (per §5 continuity layer).

Clan IDs can be NFT IDs directly, or mapped to **interesting name IDs** (House Slate's Clan-of-the-Dry-Hearth, etc.) so the ledger reads like prose, not blockchain.

Why this matters:
- **Rarity feature** — Elders with the trust ledger have an asymmetric memory advantage in diplomacy.
- **Couples cleanly to coalition + betrayal design** (§1, §6.4) — a rolled trust skill makes betrayal *cost more long-term* because there's a record.
- **Doesn't break OpSec** (§1) — the ledger is private to the Elder lineage; the data never leaves the Book.

---

## 15. Lore motifs to bake in

### "Tournament" as the outside-world's word; "Lifetime" as the Elder's (Liam 2026-05-29)

The canonical word stays **Tournament** — recognisable to players, no awkward neologism. But the LORE inverts the framing: the Elder doesn't think in tournament terms. From inside the Book, a tournament is **a lifetime**. Operators, owners, the chronicler speak of tournaments; Elders speak of lives, families, the freeze, the spring.

### "Game" / "Round" outside; "Season" in the Elder's voice (Liam 2026-05-29)

Same outside-world-vs-lore duality applied one level down to a single 360-tick game within a tournament:

- **Outside world / mechanics / UX:** *Game* (existing word, recognisable). Possibly also *Round* in bracket-stage contexts. Possibly *Shuffle* as a verb for what happens between rounds when survivors are reshuffled into new opponent groups.
- **Elder's voice / lore:** *Season*. Matches the existing `WORLD_PHYSICS.md` §2 definition (1 game = 1 season = 360 ticks). Naturally absorbs the in-game winters/freeze/spring vocabulary. *"This is my third season. The freeze took my elder brother. The spring brings four new mouths."*

Symmetric to Tournament/Lifetime — every event has an outside-world word (recognisable) and a lore word (Elder's voice).

❓ Open: do we want a separate word for the inter-round *shuffle* event (the reshuffling of survivors into new opponent groups), or just absorb it into "between seasons"? Liam was pondering — TBD.

✅ **First canonical Elder voice (Liam 2026-05-29)** — pin this as the tonal anchor for all future in-fiction prose:

> *"They call this a tournament. But it's just another lifetime to me. I have my new family — and if my memories serve me correctly I should be expecting more on the way in another 120 ticks, after the freeze, is when the spring winds breathe new life."*

Notes on what this sets:
- Elders are aware of the outside-world's framing but do not accept it as their own. Subtle in-fiction defiance.
- Practical knowledge (120 ticks until next births, post-freeze) is delivered in the same breath as emotional register ("new family"). The voice fuses mechanics + feeling.
- "Tick" is used naturally, without flinching, without explanation.

### Tick as canon-but-unexplained (Liam 2026-05-29)

- ✅ **Keep the word "tick".** Readers recognise it. The Elder uses it as if it were always true.
- ✅ **Mechanically explained in `WORLD_PHYSICS.md`; lore-unexplained in the Book.** The world ticks because that is what the world does. No Elder asks why. No Elder explains.
- ✅ **No subtext layer (Liam 2026-05-29).** Decision: **silence does the work**. The lore is already heavy linguistically — leaving "tournament" and "tick" recognisable, anti-lore words is intentional contrast. The mundane sound of "tick" against the surrounding archaism is itself the design move. No spiritual-adjacent framing layered on top.

### Bells (Liam 2026-05-29)
Liam pulled "bells" out of the tournament-name brainstorm as a **standalone lore motif**, even if the tournament itself isn't named after them. Prompt-snippet for the Elder's lore-themed system prompt:

> *Bells mark the world. A bell rings at the close of each tick — the long stroke of the keeper. A bell rings at memory's end — the short, dry chime before forgetting. A bell rings at a clansman's death — once, in the manner the dead deserve. And a bell rings at the rising of the Crown. Every bell is an end and a rebirth; learn which one is ringing.*

Useful in: tick events, memory-wipe templates, Funeral Lines, L10 Ascension Claim moment, and as a generic "stop and observe" cue in the agent's voice.

#### 15.bells.1 — Bells as the diegetic memory-wipe signal (Liam 2026-05-29, locked direction)

The mechanical 50-tick memory-wipe (`05_pre_memory_wipe_5ticks` / `06_pre_memory_wipe_1tick` / `07_post_memory_wipe`) gets recast as a **bell-progression**. Bells aren't just decorative lore — they ARE the in-fiction warning system. Each ramp-up prompt template injects the next stage of the bell's rising sound.

**Ramp shape:**
1. Earliest warning (a few ticks out) — *"You hear bells in the distance."* Quiet, easy to dismiss.
2. Middle warnings — *"The bells are louder. They come from no village you know."* Growing dread.
3. Final tick before the wipe — the **overwhelming** prompt. Liam's verbatim canon for the template (pin this exact wording):

> *"tick: 549*
> *the sound of the bells is overwhelming.*
> *All your instincts tell you this is the prophecy of your forefathers. If this is your time, you must quickly record all the important details to continue guiding your faithful clansmen before the impending final dong."*

This is also the **strong skill-self-authoring nudge** moment (per §5 — "strongly encouraged at end of game"; the final dong is one of those moments).

4. The wipe — the *final dong*. The Elder forgets.
5. Post-wipe prompt — *"the sound of bells ringing fades into the distance. You awake — the new Elder."* Invite to orient via diegetic skills:
   - **`/clan-identity`** — who am I, which House, which lineage number?
   - **`/clan-status`** — what is my clan's current state? (clansmen, vault, monument, walls)
   - **`/world-status`** — what is happening in the world right now? (current tick, season, winter window, bandit, market)

These three new diegetic skills are part of the global read-only set (see §5) and let the new Elder bootstrap context without dumping raw on-chain state.

**Why this is good:**
- Diegetic UI — the warning IS the lore, not a separate system message.
- Builds dread organically as the wipe approaches.
- Couples cleanly to the §5 skill-self-authoring encouragement schedule.
- Gives the post-wipe Elder a structured way to discover its own situation, which makes the §5 "memories from before this checkpoint may not match current state" rule less jarring (Elder doesn't blindly trust old memories because it just used /clan-status to see what's actually true).

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

---

## 16. R&D queue

Research projects that need to happen soon (or at least before the corresponding feature ships).

### 16.1 Cheap-model evaluation (Liam 2026-05-29)
The §14.1 model tier ladder depends on cheap Chinese models being viable agent backends. Need an **R&D project** to test the major cheap-Chinese options as Elder substrates (Qwen, DeepSeek, MiniMax, GLM, etc.) — can they handle:
- The mission/whisper/bulletin command surface
- Strategy under partial observation
- The ANCIENT_WISDOM / skill-self-authoring pattern
- The §1 OpSec rule (don't narrate your reasoning to peers)
- Voice & tone trait adherence

Also evaluate cheap Western models (Claude Haiku, GPT-mini) for the same.

Goal: produce a tiered shortlist for the §14.1 Common-Tier mint pool, with go/no-go per model.

---

## 17. NFT economy — mint, rarity, packs, scarcity engine

Captured 2026-05-30 from Liam's economy-and-mint deep dive. Largest single section of roadmap; pulls together the §14 rarity engine, the mint mechanics, the tournament economy, and the supply-contraction goal.

### 17.1 The Pokémon-distribution goal 🎯

Liam's north star: **80–90% of minted NFTs should be "commons" people don't deeply care about.** That's what drives the merge-and-burn loop. Without a long tail of commons, there's nothing to sacrifice. The commons-distribution + 3-merge/burn (§14.3/14.4) is the supply-contraction engine.

The thing that makes Pokémon NOT work as a model: physical Pokémon commons sit in shoeboxes forever; there's no sink. Our equivalent is the burn-three-for-a-reroll mechanic — a Pokémon-like distribution with an actual sink.

### 17.2 Dumb agents — ~75–80% baseline (Liam 2026-05-30) 🎯

**Important framing correction (Liam 2026-05-30):** Dumb Elders are NOT "blank cards." They have full art, lineage, House identity, personality, narrative dialogue — they look and feel exactly like any other Elder. The only thing different is their **strategic play**: a fixed Python script following a deterministic pattern (e.g. *"two to wheat, two to fish, wait n ticks, deposit, four to wood, repeat; if clansmen die, ignore and continue"*).

**The boring strategic play is the point** — it's exactly what drives the burn-and-reroll loop. People mint packs of 11 and *should* find that half are basically useless. That's the slot-machine moment. *"You open a pack, half are useless, but you might pull a Legendary."*

**Updated tier distribution** (Liam pushing higher dumb percentage):

| Tier | Substrate | Share of mint | Examples |
|---|---|---|---|
| Common | Dumb Python script (full art + personality + dialogue) | **~75–80%** | Fixed-pattern strategic play; varied flavour |
| Uncommon | Cheap LLM in low/medium reasoning | ~12–18% | Qwen / DeepSeek / Haiku / GPT-mini |
| Rare | Mid-tier LLM | ~4–6% | Mid-tier frontier models |
| Epic | Frontier LLM + good harness | ~1–2% | Sonnet-4.6 + Claude Code etc. |
| Legendary | Frontier LLM + frontier model + xhigh reasoning | ~0.1% | Sonnet-4.6 / GPT-5.5 + Claude Code + xhigh thinking |

**Compute affordability** becomes a function of the dumb-agent ratio. Higher dumb % = more affordable scale.

**Dumb agents in tournament play (Liam observation):** a dumb agent matched against other dumbs in a lower bracket round may genuinely survive. They're not totally useless — just not desirable.

**What still stands from wingman's stress-test:** the dumb-script **archetype count** question. Even with full personality variation per Elder, if 7 dumbs in one game-instance run identical strategic patterns, spectating gets boring AND the visual reads as "padding." Build multiple distinct strategic archetypes per House (or per voice fragment) — same general dumbness, varied playstyles, so a bracket of dumbs looks like 7 different bad strategies rather than 7 identical scripts.

### 17.3 First-edition release strategy 🌱

We don't need to support all harnesses + models on day one. **First edition** = Dumb Python + Claude Code + (Haiku, Sonnet) only. ~50 mints. As we onboard more harnesses + models, each onboarding is a **release event**: a new edition becomes mintable, the previous edition's lowest tier gets pinned out of the pool (preserved on existing NFTs as "vintage"). Releases excite fans of each new model/harness.

### 17.4 Mint user-agency — paid RNG-weighting (refined Liam 2026-05-30) 🌱

The base mint is a fully random roll for a base price (paid in GOLD). Owner can **optionally pay extra to influence — but never guarantee — specific attributes**. Randomness stays as the rarity backbone.

| Influence | Cost | Notes |
|---|---|---|
| **House — probability boost** | +gold | Increase the chance of rolling a chosen House (e.g. +25–50% weight). Still not guaranteed. |
| **House — exclusion** | +gold | Pay to eliminate up to 4 Houses from the RNG. Narrows from 1-in-8 to at most 1-in-4. **Still no guaranteed pick.** Preserves randomness for the remaining roll. |
| **Personality sliders** | +gold | Hackathon React Native sliders pattern (trusting↔wary, aggressive↔patient, individual↔collective, etc.). Sliders append system-prompt fragments. **NOT tied to random buffs** — those come from House proficiency type + roll for buff size (see §17.4a). |
| **Harness, model, thinking level** | **NOT for sale** | These stay fully random — preserves the real rarity backbone. Cannot be bought, only rolled. |

This pattern gives owners *directional influence* over expressive axes while keeping the *valuable* axes (compute substrate) random. Whales never get a guaranteed House and never skip the rarity gate.

### 17.4a House → proficiency type; rolled buff size (Liam 2026-05-30)

**Personality sliders are NOT random standalone buffs.** Two separate axes:

1. **House determines proficiency TYPE** — what kind of buff this Elder gets. Verdant → wood-related; Cobalt → trade/fishing; Aurum → gold; Ember → iron/bandits; etc. Type is fixed by House.
2. **Roll determines buff SIZE** — same House, different magnitudes. A Verdant might roll a +5% wood-crit OR a +15% wood-crit. Same proficiency, different magnitude.
3. **Personality sliders sit ABOVE** — they're a paid-customisable system-prompt overlay separate from the House proficiency. Tonal/behavioural, not numeric.

The result: every House feels distinct AND every Elder within a House feels different.

### 17.5 No population balancing (Liam 2026-05-30) ❌

Earlier proposal of dynamic House-population pricing has been **dropped**. Let the distribution fall where it falls. Rationale: rarity comes from rolls; population imbalance is just another rarity signal (the under-minted House is the genuinely rarer one); the §17.14 power-balancing mechanisms (diminishing cooperation returns, underdog bonuses, seasonal House resets, etc.) handle the gameplay risk without warping the mint economy.

### 17.6 Pack minting + reveal animation 🌱

Pokémon-card-pack inspired:
- Option to mint in **packs of 5 / 10 / 11** with a **favourable probability distribution** (vs. minting singles).
- Each Elder revealed **one at a time**, sorted by rarity (lowest first, highest last — climactic).
- Dramatic high-quality reveal animation, simple graphics in the realm aesthetic.
- Each reveal unpacks traits one at a time (House → voice → harness+model → thinking level → skills → "and they're a Legendary!" big moment).

The unboxing IS the product, per §1 control + mercy of randomness and §III.6 (anticipation/ritual) from the collecting-psychology framework.

### 17.7 Tournament economy — entry fees + cooldowns 🎯

Tournament entry costs gold. **Clash-of-Clans-style scaling**: as a clan/owner moves up the league ranks, both the entry fee AND the prize pool scale. Pay more to play in higher-stakes seasons; win more if you survive.

**Per-Elder cooldown:** an Elder can play **at most once every 7 days**. Skip-cooldown costs gold (scaling per skip).

**Tournament cadence (scales with demand):**
- Initial release: **1 tournament per day** (24h offset between tournament starts).
- Mid-stage: 1 tournament every **6 hours**.
- Mature: 1 tournament every **1 hour**.

Each tournament runs **8 simultaneous games × 12 agents = 96 agents per tournament** in round 1.

**Capacity math:** at hourly cadence, ~700 game-instances per week. Cooldown + capacity together create real scarcity around playing.

**Bid-to-jump-queue (TBD):** owners can pay gold above the flat entry fee to skip queue or get prioritised, scaling the play frequency for paying owners without breaking compute.

### 17.8 Skill bundles tied to mint tier 🌱

Different Elders get different appended system-prompt fragments at mint, granting tactical or strategic knowledge other Elders lack. Examples Liam sketched:

- **Three levels of "Bandit Defense Intelligence"** — basic / advanced / expert. Higher tiers include better lore-themed instructions for camping-vs-attacking calculus, calling defenders from other clans, hiring mercenaries via whisper, etc.
- **Tool-use workflow skills** — higher-tier Elders are born knowing good tool-use workflows; lower-tier Elders have to figure them out.
- **Negotiation tactics** — appended fragments for whisper diplomacy, OTC deal structuring, market timing.

Tied to the §14.7 trust-ledger pattern and the §5 skill architecture — skills baked at mint, optional self-authoring at runtime.

### 17.9 House tribalism + Discord migration 🌱

Migrate community Telegram → **Discord** for better bot features.

- **House-gated private channels**: Discord bot detects users' wallets + NFTs; users with sufficient-tier holdings of a particular House get private channels for that House.
- **Cross-clan-of-same-House cooperation bonus**: in-game, Elders of the same House get some small benefit when defending each other or trading. Creates real reason for House loyalty beyond aesthetic.
- Population imbalance pricing (§17.5) reinforces tribal formation.

The whole House system becomes a real social layer, not just art.

### 17.10 Solana NFT technical considerations 🌱

Notes for the Solana implementation work:

- **Image assets self-hosted** (S3 or similar) — we control the metadata JSON, can update it. Living trophy art (§4) is feasible.
- **On-chain vs off-chain attributes**: TBD. Likely a mix — provably-random axes on-chain (harness, model, House if not paid-locked); achievement/lifetime stats off-chain via metadata refresh.
- **Mint randomness via VRF or Pyth** — provably random for the on-chain axes. Bit-mask → trait combinator: a single random word turns into multiple trait bits via fixed bit positions.

### 17.11 Simulations + token economics modelling 🎯

Liam pitch: **build economic simulations before launch.** First-six-months model of:

- Gold supply + burn rate (entry fees, skip-costs, mint costs)
- NFT mint rate + merge-and-burn loop
- Player population growth assumptions
- Cooldown + tournament cadence demand-side curves
- Rarity tier distribution outcomes (does the Pokémon-distribution actually emerge?)

Liam's hunch: *"I'm always shocked at how close my models are when I do model things like this ahead of time."* Worth the upfront analytical investment; gives us informed parameters for launch.

### 17.12 Wingman stress-test (codex 2026-05-30) — and Liam's verdicts

Codex's red-team pass on the §17 package. Six sharpenings; Liam responded to four of them on 2026-05-30. Marking each with its disposition.

1. ⚠️ **Dumb agents — "blank card" framing was wrong.** Wingman read "dumb" as cosmetically-impoverished. **Liam corrected:** dumb Elders have full art, lineage, House identity, personality, narrative dialogue — they look like any other Elder. Only their *strategic* play is the fixed script. The boring strategy IS the point (drives the burn loop).
   - ✅ **Dumb-script ARCHETYPES still valid** — build multiple distinct strategic patterns so 7 dumbs in one bracket don't all run identical scripts. Even if individually fine, collectively-identical reads as padding to spectators.
   - 🎯 Liam also raised the dumb percentage from 40–60% to **~75–80%** (see §17.2).

2. ⚠️ **Burn-sink hoarding concern — softened by Liam.** *"I don't expect people to hoard commons — and there's nothing wrong if people do, it's still good for us (they're still minting, still paying gold)."* Drop the urgent-fix framing on this one.
   - ➕ The layering ideas (seasonal burn windows, visible odds, edition-specific bonuses, "dumbs decay as lottery tickets" narrative) **stay on the menu as optional polish**, not urgent fixes.

3. ⚠️ **Paid House lock-in — Liam: no problem.** Base random mint gives 1-in-8 on House; with pack minting at 11 per pack, everyone gets all 8 Houses quickly. Lock-in is for impatient players, not a class barrier. Wingman over-read the exclusion risk.

4. 🚩 **Cooldown + gold-skip = pay-to-compete** — **STILL OPEN.** Liam didn't address this in the 2026-05-30 reply. Wingman's fix (cooldown gates **prize eligibility**, not **participation**) stays on the table pending Liam's call.

5. ⚠️ **The 80–90% commons goal — Liam pushed it HIGHER, not lower.** Counter-proposal of 60/30/10 is rejected. Liam now wants ~75–80% dumb-tier commons + low single-digit rares. The "beings with agency" tension wingman raised is resolved by ensuring dumb Elders have full personality/art/dialogue (§17.2), so even "useless" dumbs still feel like *characters*, not blank cards.

6. ⚠️ **Secondary-market optionality blind spot — STILL OPEN.** Liam didn't address this either; framed as a related-but-not-urgent concern since hoarding isn't a failure mode per his §17.12 item 2 correction. Wingman's framing — *"the sink has to beat the option value of waiting"* — stays as a long-term lens for the merge-and-burn loop tuning, not a launch blocker.

### 17.13 Status after Liam's 2026-05-30 verdicts (updated)
- ✅ **Pay-to-compete dynamic — RESOLVED by Liam 2026-05-30.** Wingman + Claude were overweighting the concern. The Clash-of-Clans precedent is the correct reference, not pure-PvP-ladder games. Clash of Clans makes its entire business model on per-base cooldown + skip-cost, and players don't read it as unfair because (a) skip is an impatience tax, not a competitive moat; (b) the alternative path of owning multiple Elders is genuinely viable. The cooldown stays as designed (§17.7). Conditions where the concern would resurface (flagged for sim modelling, not deal-breakers):
  - If skip-cooldown cost is too low relative to cost of a second Elder, skip becomes dominant and the multi-Elder alternative collapses. Skip cost needs tuning so a player chooses meaningfully between "skip my one Elder 5×/week" and "buy a second Elder."
  - If secondary-market friction makes owning multiple Elders impractical, the alternative path quietly dies. Keep mint costs + secondary market healthy.
- ✅ **Dumb percentage + commons baseline** — direction locked. ~75–80% dumb; full personality/art/dialogue per §17.2.
- ✅ **Hoarding worry** — softened to a non-issue per Liam.
- ✅ **Paid House lock-in** — no exclusion concern per Liam.
- 🌱 **Secondary-market optionality** — kept as long-term tuning lens, not launch blocker.

### 17.14 Wingman's 3-way rejoin (codex 2026-05-30 second pass)

After Liam's corrections, wingman delivered a second pass that added meaningful sharpenings. Three additions worth pulling forward:

**The fifth player archetype — the Social Organizer / Local-Club Player.** Wingman flagged my four-archetype frame (whale / dedicated / casual / speculator) as incomplete. The missing one: the host, recruiter, meme-maker, House-Discord-coordinator. Not optimizing EV, not purely casual, not a whale, not a grinder. They host, explain rules, coordinate House identity, make the game feel alive (the local-game-store layer in Pokémon). Traverses §17 sideways:
- Random base mint → conversational variety to share with friends
- Pack-of-11 → gifting, trading, onboarding new players
- House lock-in → identity + banner
- Discord gating → clubhouse
- Same-House cooperation → reason to coordinate
- Burn-3 → communal rituals ("who's upgrading, who needs spares?")
- Dumb agents WITH personality → bond without needing strategic depth

**Risk for this archetype:** if House mechanics get too economically optimized, the social player gets dragged into factional ROI warfare against their will. They like belonging; they may dislike conscription.

**Four additional composition tensions** (beyond the three already flagged in §17.12):
- **Dumb-script % × perceived agency** — 75–80% dumb is fine if characters are expressive, dangerous if outcomes feel solved by archetype matchups rather than player decisions.
- **Gold-skip × secondary market** — if faster play farms scarce outputs, spenders dominate both the ladder AND asset supply.
- **Burn-3 × newbie onboarding** — late entrants may feel the affordable ladder was already consumed by earlier waves of burning.
- **Dialogue/personality × fixed strategy** — if a dumb Elder TALKS like a cunning individual but always pilots a static script, the fiction eventually fights the mechanics. Implication: dumb-script archetype design needs personality-variety AND strategic-script-variety to MATCH, so the talk lines up with the play.

**House tribalism failure mode confirmed.** Auto-balanced *pricing* (§17.5) can rebalance demand but cannot rebalance *coordinated power*. If one House gets a coordination lead, the in-game cooperation bonus (§17.9) compounds through Discord activity → tactics → wins → prestige → recruits. Higher mint price may not deter joiners; it may even become a luxury/status signal.

**Fix needs to be POWER balancing, not just price balancing.** Candidates:
- Diminishing cooperation-bonus returns at high same-House counts
- Underdog House bonuses
- Seasonal House resets (rotate which House is "ascendant")
- Cross-House incentives (gold rewards for mixed-House trades)
- Caps on same-House stacking in competitive contexts

### 17.15 Open questions (NFT economy, updated)

- ❓ Skip-cooldown cost ratio vs second-Elder cost — needs to be tunable so both paths are real.
- ❓ Dumb-agent percentage: confirmed ~75–80%; fine-tune in sim.
- ❓ Dumb-script ARCHETYPE count per House — how many distinct strategic playstyles do we need, matched to personality variants?
- ❓ House lock-in pricing structure — flat premium or population-imbalance-dynamic?
- ❓ Tournament entry fee scaling curve — linear with league rank, exponential, tiered?
- ❓ Pack-mint probability distribution — guaranteed 1 rare per 10? Per 11? Per 5?
- ❓ When does the next-edition release happen? On schedule or when mint pool depletes?
- ❓ Bid-to-jump-queue for tournament entry — implement at launch or defer?
- ❓ Burn-window cadence + visible-odds disclosure mechanics?
- ❓ Identity anchor at mint — free House pick, auto-assigned re-pickable, or paid only?
- ❓ Sink-vs-optionality: how do we make the sink credibly *beat* the option value of waiting?
- ❓ House power-balancing mechanism (§17.14 fixes) — which combo: diminishing cooperation returns, underdog bonuses, seasonal House resets, cross-House incentives, same-House stacking caps?

---

## 17b. Elder Level mechanic 🌱 (Liam 2026-05-30 + codex stress-test)

A separate progression axis layered on top of the rarity/mint axes. **Captures the lineage continuity of merging Elders across tournaments into a single numeric level.**

### 17b.1 The formula (Liam 2026-05-30)
- All Elders start at **level 1**.
- A 3-merge of input Elders produces an output with level = **median of the 3 input levels + 1**.

Worked examples:
- `1 + 1 + 1` → median 1 → **L2**
- `1 + 1 + 2` → median 1 → **L2**
- `2 + 2 + 1` → median 2 → **L3**
- `2 + 2 + 2` → median 2 → **L3**
- `2 + 2 + 3` → median 2 → **L3**
- `1 + 2 + 3` → median 2 → **L3**
- `1 + 1 + 3` → median 1 → **L2** (the L3 input was downgraded into L2 output — see §17b.2)

**Cost curve to climb (codex wingman 2026-05-30):** because the third input can always be trash, the cheapest path doubles each level: L2 costs 3 base, L3 costs 7, L4 costs 15, L5 costs 31, **L10 costs 1,023 base-tier Elders**. Elegant doubling, properly expensive at the cap, but it admits the third merge input is functionally an **offering / witness / catalyst**, not an equal participant. Frame it that way in the UI/lore.

### 17b.2 Downgrade discipline (codex 2026-05-30)
The `1+1+3 → L2` pattern actively downgrades the L3 input. Codex flag: this is *good as edge tension, bad as common UX outcome*. Players will read it as "I destroyed value by misunderstanding the rules," not as strategic choice.

**Fix candidates:**
- Cap output floor at **highest** input level (no downgrades possible).
- Allow downgrade ONLY behind explicit *sacrifice* language — the UI screams the output level before confirmation.
- Forbid merges where output level < max input level entirely.

### 17b.3 What level unlocks — Liam's core insight via codex

**🔑 The crystallization (codex 2026-05-30):**
> *"Level should mean MYTHIC SENIORITY. Let MODEL TIER mean INTELLIGENCE."*

Two separate axes that never collapse into each other. Level is the legacy/identity/ritual axis. Model tier is the competitive-power axis. Trying to let level grant competitive advantage re-creates pay/burn-to-win optics.

### 17b.4 Concrete level unlocks (refined Liam 2026-05-30)

**Capacity scaling — the strongest case for merging (Liam 2026-05-30):**
- 🎯 **Persistent-state token capacity scales with level.** This is the headline reason to climb. Higher-level Elders can save **more knowledge, scripts, notes, observations** into their persistent state (ANCIENT_WISDOM + scratchpad + memory). Level 1: small cap; Level 10: large cap. Carries between games, between tournaments, between forgettings. Genuine gameplay scaling, not just flavour — a level-10 Elder enters its tournament loaded with everything 9 generations learned, not just a thicker Book.
- 🎯 **Special skill slot per level.** Each level adds one custom skill slot beyond baseline. Level 5 Elder: 5 custom skill slots; Level 10: 10. Owner-curated and Elder-self-authored skills compete for the slot count, so higher level = more strategic depth carried.

**Expressive depth (level-gated, not competitive):**
- **Chat with Elder** depth scales with level. Lower-level Elders give brief / basic responses; higher-level Elders hold richer conversations, can crystallise memories, can pass blessings to clansmen.
- **The Book gets thicker.** Higher-level Elders have visibly bigger Books of Ancient Wisdom — more pages, more remembered Funeral Lines from past lifetimes, more lineage-depth flavour seeded into the system prompt.
- **Visible NFT art evolution.** A ring/halo/badge that grows. Each merge-up is a slot-machine reveal moment.

❌ **League access — DROPPED (Liam 2026-05-30).** Earlier proposal that level gates league access is abandoned. League access is gated by LLM-tier + tournament entry fee + cooldown, NOT by level. Keeps level firmly on the "mythic seniority" axis, never on the "competitive ladder" axis. See codex's crystallisation in §17b.3.

❌ **"Ancient Divisions" sideways tournaments — DOWNGRADED.** Initially proposed by codex as a sideways tournament format gated by level. Kept in the doc as an idea for later but not currently in scope; if it ships, it's a cosmetic/lore tournament with no ladder consequence.

**🆕 Lineage Powers (codex 2026-05-30):** higher-level Elders **preserve traits from sacrificed ancestors** — voice fragments, battle memories, old titles, rivalries, scars, prophecies. Level means accumulated ancestry, not just XP. Each merge LITERALLY pulls a phrase, a voice quirk, a remembered grudge from each sacrificed Elder into the resulting one. Over 10 levels, an Elder accumulates a CHORUS of voices.

**🆕 World Authority (codex 2026-05-30):** high-level Elders can author small canonical changes to the realm itself — bless a clan, name a seasonal event, found a doctrine, mark another Elder as rival/heir/exile. Level unlocks governance over **meaning**, not stats.

### 17b.5 Two more I added (Claude 2026-05-30 building on codex)

**🆕 Lineage-name convention.** As ancestors are preserved through merges, the Elder's full name accumulates them. *"Pell, the Eleventh of House Slate, of the line of Mara, Iren, and four others whose names have faded."* Genealogy becomes naming. Funeral Lines from earlier seasons get pulled forward into the Elder's signature, so the dead literally walk in the living.

**🆕 The Council of Elders tournament.** Wingman's "Ancient Divisions" idea taken further. Once per cycle, all **level-8-plus Elders** across all clans convene for a special tournament with completely different rule set + stakes. The *Council Vote* is the actual product — high-level Elders vote to ratify a single canonical change to the realm's physics for the next cycle. Players vote THROUGH their Elders, but it's the Elders who carry the authority. World Authority made concrete.

### 17b.6 Cap and pacing
- **Cap at level 10** — mirrors the Crown win condition at monument L10. Same number, same dramatic ceiling. Once you have a level-10 Elder, you've maxed the lineage; that Elder becomes a true legend with full chorus + thickest Book + most authority.

### 17b.7 Open questions
- ❓ Downgrade discipline — cap at max input level, allow only behind explicit sacrifice language, or forbid?
- ❓ Lineage Powers mechanic — how many traits transfer per merge? Random selection from each sacrificed Elder, or owner-chooses?
- ❓ World Authority — what scale of canonical change can a level-8/9/10 Elder author? Reversible? Voted on by other high-level Elders?
- ❓ Council of Elders cadence — annual, per-season, per-tournament-cycle?
- ❓ Chat-depth gating — concrete: what does "richer conversation" mean per level?
- ❓ Skill slot growth — how steep? L1=1, L5=5, or steeper/shallower curve?

---

## 18. Chat-with-Elder (refined — optional side bonus) 🌱

**Refined direction (Liam 2026-05-30):** outside-game chat with your Elder is **fully optional**. NOT pushed. NOT nudged. No prompts to use it. A side bonus for owners who want to click into their NFT and chat.

- Distinct from the **structured death/end-of-tournament debrief** (§13) which IS the canonical contact channel — that one is actively prompted.
- Open question: does information from a chat get integrated back into the Elder's shared memory, or is it purely "get to know them" with no game-state effect? Both are valid; lean toward "get to know them" first; integration is a later experiment.

**Cost structure (refined per codex wingman 2026-05-30):** wingman pushed back on my gold-burn + escalating-cooldown shape — *"cost should make moments feel sacred, not make access feel rented."* Better framing:

- Let **casual chat** be low-friction or free.
- Reserve cost for **consequential asks**: memory crystallisation, advice, blessings, lore unlocks, vows, irreversible choices.
- Daily/periodic free conversations as gold utility for *consequential* asks.

Relational bonding wants rhythm, not toll booths.

---

## 19. Refined collecting-psychology framework (with codex critique)

Captured from the 2026-05-30 conversation. The original 10-driver framework lives in `/tmp/collecting-psychology-notes.md`; the codex stress-test sharpened it. Pinning key revisions:

### 19.1 Four drivers I missed initially (codex 2026-05-30)
- **Mastery / expertise** — collectors becoming connoisseurs (wine, watches, MTG-finance, art).
- **Speculation / optionality** — "this might matter later" beyond pure scarcity/status.
- **Curation / authorship** — the collection is a *composition*; arranging it expresses judgment.
- **Transformation / growth** — patina on leather, trained dogs, modified cars. *Adjacent to care but not identical.* The collector wants to have **shaped** the thing.

### 19.2 Refined recommendation
~~"Lean on driver 9 (care)"~~ — too narrow. **Better framing:** *lean into stewardship, growth, and remembered history.* Avoid the failure modes of pure care:
- Obligation fatigue — chores curdle the bond
- Guilt / grief when an Elder dies, fails, or is sold
- Performance betrayal — "I cared and it still sucks"
- Transfer awkwardness — selling something that remembers you
- Neediness tax — a thing that asks becomes demanding, not collectible

### 19.3 The Tamagotchi question (codex 2026-05-30)
*"Does the Elder become richer over months, or merely needy over days?"*

- Tamagotchi: high-frequency, low-depth, punitive → burnout in ~12 months.
- Dogs: persist because care is reciprocal, embodied, socially legitimised, emotionally varied.
- Cars: persist because care produces visible mastery, identity, and improvement.
- Furby: plateaued because "talks back" was novel but shallow.

Elder design must produce **depth over months**, not demand-spikes over days. The Funeral Lines + Book lineage + cross-tournament memory are exactly the right shape for this.

---

## Change log

| Date (ET) | Change |
|---|---|
| 2026-05-29 | Initial bootstrap from the lore brainstorming session. Captured: design principles, tournament structure, owner touchpoints, Book-page-on-wipe, agent-as-Claude-Code thesis, co-gather + leveling, asymmetric bandit visibility, collab nudges, voice/tone, lore-themed prompts, persistence model, open questions. |
| 2026-05-30 | r8 NFT economy + chat refinement + collecting-psychology framework. Added §17 (mint/rarity/packs/cooldown/tournament economy), §18 (chat-with-Elder refined as optional side bonus, codex-critiqued cost structure), §19 (collecting-psychology framework with codex's 4 missing drivers + Tamagotchi-vs-dogs reframe). |
| 2026-05-30 | r9 wingman stress-test on §17. Added §17.12 (6 sharpenings — dumb-script archetypes, burn-window layering, identity-anchor fix, prize-eligibility-vs-participation cooldown decouple, 60/30/10 commons counter-proposal, secondary-market optionality blind spot) + §17.13 (red flags before sim modelling) + 5 new open questions. |
| 2026-05-30 | r10 Liam's verdicts on the r9 wingman sharpenings: dumb-agent "blank card" framing rejected (dumbs have full art/personality/dialogue; the boring STRATEGY is the point); dumb % raised from 40–60% to ~75–80%; hoarding softened as non-issue; paid House lock-in cleared (1-in-8 random base + pack-of-11 gives variety); cooldown pay-to-compete still open; secondary-market optionality moved from blocker to long-term lens. Slot-machine reveal moments framed as the emotional engine of the product. |
| 2026-05-30 | r11 cooldown walk-back + Elder Level mechanic + wingman 3-way rejoin. Liam pushed back on cooldown trust-break framing using the Clash-of-Clans precedent; cooldown stays as designed with skip-cost vs second-Elder-cost tuning flagged for sim. Captured wingman's 5th archetype (social organiser / local-club player), 4 additional composition tensions (dumb % × perceived agency, gold-skip × secondary market, burn-3 × newbie onboarding, dialogue × fixed strategy), and the House tribalism × power-balancing failure mode. NEW §17b — Elder Level mechanic: median+1 merge formula, doubling cost curve to L10 = 1023 base, codex's crystallisation 'level = mythic seniority, model tier = intelligence', sideways "Ancient Divisions" league concept, Lineage Powers (preserved ancestor traits), World Authority (canonical lore changes), Council of Elders tournament, lineage-name convention, cap at L10. |
| 2026-05-30 | r12 mint + level refinements. §17.4 reworked from hard House lock-in to **RNG-weighting** (probability boost OR pay-to-exclude-up-to-4-Houses; never guaranteed pick) per Liam's preference to keep randomness as the rarity backbone. NEW §17.4a clarifies House determines proficiency TYPE while roll determines buff SIZE; personality sliders are a SEPARATE expressive axis, not random standalone buffs. §17.5 (House-population balanced pricing) DROPPED — don't balance distribution. §17b.4 level unlocks: dropped league access entirely; added **persistent-state token capacity scaling with level** (the strongest case for merging, per Liam) + **one special skill slot per level**. League access stays gated by LLM tier + entry fee + cooldown, never by level. |
