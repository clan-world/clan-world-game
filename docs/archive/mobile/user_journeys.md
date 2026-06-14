# Clan World Mobile: Six User Journeys

**Purpose.** These are the six end-to-end user journeys we are building toward for the Easy A Solana Mobile track submission. They function as our north star for implementation. Every screen, every Convex query, every piece of native plumbing should justify itself by serving at least one of these journeys.

**Audience.** Liam, for review and pushback. You have repo and game context I don't, so any of these may need refinement based on what's actually feasible in the time we have.

**Scope.** This document covers the journeys only. It does not cover the slide deck, the video, the written submission, or the live presentation. Those are downstream of these journeys.

**Revision note (v2).** This version reframes Journey 1 around Seeker Genesis Token attestation and adds the FREE Forge mechanic as a payoff beat in Journey 2. Together they make Seeker recognition the most distinctive narrative in the demo, splitting it into two beats: identity recognition (J1) and reward delivery (J2).

---

## Strategic frame

We are pitching to two audiences in one submission.

**Solana Mobile / dApp Store judges** want to see MWA used non-trivially, multiple native mobile features exercised meaningfully (not as checkbox demos), and a credible viral consumer app that justifies dApp Store featuring. They are explicitly looking for "mobile-first experiences that resonate with crypto users".

**Easy A general judges** want to see a coherent story, a real product (not a tech demo), and emergent behavior that suggests this could become a thing.

Each journey carries weight for both audiences. If a journey only impresses one group, it's wasted real estate.

The six journeys also serve as our **vertical-slice development plan**. We pick journeys narrow enough that we can finish all of them, broad enough that they collectively cover every screen and feature that matters.

---

## Coverage matrix the journeys must hit (collectively)

1. MWA wallet connect (first impression, dApp Store requirement)
2. MWA transaction signing (must appear at least twice to feel real, not once as a token)
3. Live Convex reactivity (the cockpit and Hearth update in real time)
4. WebView cockpit handoff (the centerpiece technical achievement)
5. Home-screen widget (distinctive, judge-impressing, dApp Store native)
6. Push notifications + deep linking (mobile-native, ties off-app behavior to in-app context)
7. Haptics (small but meaningful)
8. Marketplace / rental loop (the economic story that justifies "viral")
9. Agent autonomy (the agentic narrative that justifies "novel")
10. Owner-as-coach (the human-in-the-loop that justifies "fun")
11. Gold economy (closes the play-to-earn loop)
12. Seeker attestation and reward (the dApp Store narrative differentiator)

---

## Journey 1: The Seeker's Welcome
### Onboarding + Wallet + Seeker Genesis Token Attestation

**Story.** A new user installs Clan World on their Seeker, opens the app, and joins the realm. The app cryptographically recognizes that they are a Seeker bearer (via the on-chain Genesis Token in their built-in wallet) and grants them a privilege that non-Seeker users do not get: their first Elder is free to forge.

**Narrative beat.** This establishes Clan World as built *for* the Seeker, not ported to it. The first thirty seconds carry credibility (real MWA, real Solana wallet) and seed the payoff that lands in Journey 2. The audience walks away from this journey knowing two things: this is a real Solana Mobile app, and Seeker bearers are first-class citizens here.

**Flow.**
1. App icon tap. Splash screen with Clan World emblem and "Ælder Whispers" script.
2. Connect Wallet screen appears with the parchment narrative line.
3. User taps `CONNECT WALLET`.
4. **MWA fires.** The Seeker's built-in wallet opens, user approves.
5. Haptic feedback on signature success.
6. **Genesis Token check fires** in the background (a Convex query against the connected wallet for ownership of an NFT from the Seeker Genesis collection).
7. **If Genesis Token detected:** Hearth Dashboard renders with a parchment ribbon banner across the top: `Seeker bearer recognized. Your first Elder is forged in our hearth, not yours.` with an italicized subline: `The Hearth honors those who carry the realm in their pocket.`
8. **If not detected:** Hearth Dashboard renders normally with no banner.
9. Either way, Hearth shows the empty state (no INFTs yet, two CTAs: `MINT YOUR FIRST ELDER` and `BROWSE THE BAZAAR`).

**Coverage hits.** MWA connect (1), haptics (7), Seeker attestation (12). Sets up the payoff in J2.

**Production cost.** Low to medium. Splash, Connect screen, Hearth empty state, MWA flow, plus a Convex query that resolves Genesis Token ownership for a connected pubkey. The Convex query is the only new backend work and it's a single owner-of-NFT lookup against a known collection mint address.

**Risks.**
- The Seeker Genesis Token collection mint address must be publicly known and verifiable. Need to confirm via Solana Mobile docs or by inspecting an actual Seeker wallet. If the mint address is not stable or is gated, fall back to device-detection-only via `expo-device` build property checks (less impressive but still works).
- Genesis Token query must be fast enough that the banner appears within a second of the Hearth render. If it takes 3+ seconds, the banner appearance feels janky. Cache the result aggressively.
- A user could theoretically transfer the Genesis Token off their Seeker to game the system. Mitigation: this is an edge case for a hackathon demo and we can address it post-submission with stricter attestation.

**Open questions for Liam.**
- Do we have a published Seeker Genesis Token collection mint address we can hardcode against? If not, can we get one from the Solana Mobile team this week?
- Should the Genesis Token check live in Convex (server-side, so the result is trusted) or in the mobile client (faster, but spoofable)? Recommendation: both. Client-side for fast UI feedback, server-side as the actual gate on the FREE Forge mutation in J2.

---

## Journey 2: Forging an Elder
### Mint + Strategy + FREE Forge Payoff for Seeker Bearers

**Story.** The user mints their first Elder. They name it, choose an archetype, shape its disposition with the strategy sliders, and reach the Forge confirmation step. If they are a Seeker bearer (per J1), the 5 GOLD mint fee is waived and the parchment shows `WAIVED · SEEKER BEARER` in place of the cost. The user signs the mint transaction, the seal animation plays, and they enter the realm with their first Elder forged at no cost.

**Narrative beat.** Where the agent ontology gets introduced (Elders are autonomous, they have personality, you raise them). Also where the Seeker promise from J1 pays off in a tangible, on-chain economic benefit. The audience sees the cost line literally change from `5 GOLD` to `WAIVED · SEEKER BEARER`, which is the kind of moment that becomes a screenshot.

**Flow.**
1. From Hearth (empty state) or Hall, user taps `+ FORGE` or `MINT YOUR FIRST ELDER`.
2. **Step 1: Name & Archetype.** User types a name, taps an archetype card (e.g., "Patient Builder"). Archetype description in italic script appears.
3. **Step 2: Strategy.** User drags sliders (Trust ↔ Suspicion, Aggression ↔ Restraint, Honesty ↔ Deceit, etc.). Italic helper text below each slider updates as they drag.
4. **Step 3: Harness.** Claude Code is pre-selected. Other harness cards visibly locked with `soon` badges. A quick beat to show the multi-harness roadmap without dwelling.
5. **Step 4: Forge.** Summary card with archetype, name, strategy fingerprint, cost.
   - **For non-Seeker users:** cost line reads `MINT FEE · 5 GOLD`. Button reads `FORGE · 5 GOLD`.
   - **For Seeker bearers:** cost line reads `MINT FEE · ~~5 GOLD~~ · WAIVED · SEEKER BEARER` with the original cost struck through and the gold-bright `WAIVED` annotation in italic script. Button reads `FORGE · FREE`. A small italicized line beneath: `One free forge per bearer. Use it on your first Elder.`
6. User taps the forge button.
7. **MWA fires.** User approves a zero-cost mint transaction (the contract still requires a signature for ownership, but the gold transfer is skipped).
8. Seal animation: parchment burns gold around the edges, archetype glyph stamps with a wax-seal effect. Heavy haptic at the seal moment.
9. Navigates to INFT Detail. Parchment ribbon banner across the hero: `Welcome to your hall.` Sub-banner if Seeker: `The hearth's gift, kindled by your bearing.`

**Coverage hits.** MWA signing #1 (2), haptics (7), gold economy (11), agent ontology setup (9), Seeker reward delivery (12). The payoff to J1.

**Production cost.** Medium-high. The four-step flow is real UI work. The seal animation is the most expensive single thing in the entire demo: budget at least a full day for it. The FREE Forge mechanic adds a Convex mutation gate (server-side check that the user has a Genesis Token, has not yet used their free forge, and is minting their first Elder) plus a contract-side acknowledgment (or a Convex-only fee waiver if mint is currently Convex-mediated).

**Risks.**
- Seal animation looking janky is worse than not having it. Fallback: replace with a static "minted" frame and a heavy haptic.
- The FREE Forge gate has to be enforced server-side. A spoofed client could otherwise claim the discount. The Convex mutation must independently verify Genesis Token ownership at the moment of mint, not trust a flag passed from the client.
- Edge case: a user mints their free Elder, transfers their Seeker (and Genesis Token) to someone else, and that new user tries to mint their free Elder. Decision needed: is the FREE Forge per-bearer (anyone holding the Genesis Token at any time) or per-Genesis-Token (used once, ever)? Recommendation: per-Genesis-Token, tracked by token mint address in Convex. This prevents abuse and matches the "one free forge per bearer" framing.
- The contract may not natively support a fee waiver. If mint costs are enforced on-chain by transferring GOLD to a treasury address, the contract has to skip that transfer for waived mints. If mint is Convex-mediated (Convex acts as the dispatcher), the waiver is a one-line conditional in the action.

**Open questions for Liam.**
- Is mint currently on-chain or Convex-mediated? Affects how we implement the waiver.
- Where does the GOLD go on a paid mint (burned, treasury, prize pool)? This determines what we skip on a waived mint.
- Should the waived mint still count toward any internal counters (mint count, season eligibility, etc.) or is it fully equivalent to a paid mint? Recommendation: fully equivalent.

---

## Journey 3: Entering the Realm
### WebView Handoff + Live Cockpit

**Story.** The user dispatches their newly-forged Elder into an active season and enters the cockpit to watch.

**Narrative beat.** Wow moment for the technical audience. The transition from native shell to live cockpit has to feel seamless. The cockpit has to look sophisticated, dense, and obviously alive. This is where the "wraps the existing cockpit" architecture earns its keep, because the cockpit itself is far more impressive than anything the shell could fake.

**Flow.**
1. From INFT Detail, user taps `ENTER A SEASON`.
2. **MWA fires** (signature to enter the season, costs gold from the prize pool entry).
3. Active Game Bridge loader screen briefly appears (`Entering Storm Riders... · resolving INFT context · authorizing session`).
4. WebView cockpit mounts with `window.__clanworld` injected. The cockpit's existing UI loads, in mobile-responsive layout.
5. User sees the live tick advancing, the four agent terminals in their swipeable mobile layout, the resource vault, the comms feed with whispers and orchestrator events scrolling.
6. User swipes through the four terminals to show the density (TERM, VAULT, CLAN, 0G, COMMS).
7. Brief beat: pinch-zoom or tap on the central map view.
8. Tick advances visibly. A `[WHISPER]` from another agent appears in the comms feed: `clan-3 sent to: [2] AXL: "trade ore for wood, 2:1?"`.
9. Top overlay bar visible: `← Hall · TICK 261 · SEASON 1 · 73%`.

**Coverage hits.** MWA signing #2 (2), live Convex reactivity (3), WebView handoff (4), agent autonomy (9, the audience sees agents acting on their own).

**Production cost.** High. The WebView bridge, the cockpit's mobile responsiveness, the season entry signature flow. Hardest journey to ship and most likely to slip.

**Risks.**
- This journey is the biggest single point of failure. If the cockpit isn't mobile-responsive on time, we have nothing.
- Convex websockets must work inside `react-native-webview` with the right cookie sharing flags. Test early.
- The `window.__clanworld` adapter on the cockpit side needs to skip the desktop wallet modal and accept the injected pubkey/session. This is a coordinated change between mobile and cockpit.

**Open questions for Liam.**
- What's your current ETA for the cockpit being mobile-responsive end-to-end?
- Does the season entry flow already exist in some form, or do we need a new mutation for it?
- What's the cost (in gold, if any) to enter a season currently, and is that on-chain or Convex-only?

---

## Journey 4: The Whisper
### Owner-as-Coach + Steering

**Story.** The user sees their Elder hesitating during a critical moment, sends a steering whisper, and watches the agent respond on the next tick.

**Narrative beat.** The human-in-the-loop story. Justifies why a human would care about a game played by agents. Also exercises the bidirectional Convex flow (UI write → orchestrator → agent → response visible in cockpit).

**Flow.**
1. From inside the cockpit, the user taps the whisper icon in the top overlay.
2. Steering Console opens as a bottom sheet (does not leave the cockpit; cockpit remains visible behind).
3. User sees the message log: prior `[ORCH]` orchestrator events, prior `[WHISPER]` agent outbound messages.
4. Quick-suggestion chip row: `Pace yourself · Push aggressive · Defend the wall · Watch the bandits`.
5. User types a directive (e.g., `Crimson, the bandits are massing at the forest. Reinforce the wall before T265.`). Taps `WHISPER`.
6. Light haptic. Bubble appears as `pending`.
7. **`[ORCH]` orchestrator confirmation arrives:** `▸ Whisper acknowledged · injected at T262`.
8. Sheet dismisses. Cockpit visible again. Tick advances to T262.
9. Within one or two ticks, the agent's `[WHISPER]` outbound stream shows it acting on the directive (sending a defensive trade, ordering a wall upgrade, repositioning clansfolk). The audience sees the agent's reasoning surface in the comms feed.

**Coverage hits.** Live Convex reactivity (3), agent autonomy + owner-as-coach (9, 10), haptics (7).

**Production cost.** Medium. Steering Console UI, RN-to-cockpit bridge, orchestrator's whisper injection. The agent visibly responding to the whisper is the hardest part because it depends on prompt quality.

**Risks.**
- If the agents are still inconsistent at demo time, the whisper produces no visible response and the journey falls flat. Mitigations: (1) the agent prompt rewrite (already on Liam's task list) needs to land; (2) we can pre-script a known-responsive scenario where we've validated the agent reacts to a specific phrase pattern.
- The injection mechanism (Telegram-channels-plugin fork vs send-keys) needs to be reliable.

**Open questions for Liam.**
- Are you still considering forking the Telegram-channels-plugin for whisper injection, or sticking with send-keys?
- What's the current behavior of the agents responding to direct owner messages? Is there a minimum prompt-quality bar we need to hit before this journey is reliable?

---

## Journey 5: The Raid Alert
### Notifications + Widget + Deep Link

**Story.** The user closes the app and goes about their day. A bandit raid begins on their settlement. They get a push notification on their lock screen, glance at the home-screen widget for context, and tap the notification to drop directly back into the cockpit just in time to send a defensive whisper.

**Narrative beat.** The journey that proves "mobile-first" rather than "we ported a web app to mobile". Exercises three native features (push, widget, deep link) in one continuous narrative. Shows that owners stay engaged even when not actively in the app.

**Flow.**
1. User dismisses the cockpit with `← Hall`. Returns to Hearth.
2. **User exits the app entirely.** Phone returns to the home screen.
3. Home screen widget visible: `TICK 263 · S1 · 76%`, agent name, archetype, resource strip (gold/wood/iron/wheat/fish/blueprint), last event "+10 wheat · gather".
4. **Push notification arrives** with sound and haptic: `Bandit raid on Crimson's settlement. -2 wood at T265.`
5. **The widget visibly updates** (within seconds, since the cockpit pushed the event): resource strip now shows the wood reduction, last event now reads "-2 wood · bandit raid" in red.
6. User taps the notification.
7. **Deep link routes** directly into the cockpit, with the relevant terminal pre-focused. Heavy haptic on raid animation.
8. Bandit sprite animation plays. User sees the raid in progress.
9. User taps the whisper icon, sends a quick directive, sheet dismisses, cockpit advances.

**Coverage hits.** Push notifications + deep linking (6), widget (5), haptics (7), live Convex reactivity (3), and a callback to the whisper feature from Journey 4.

**Production cost.** High. Three separate native systems have to work in concert: FCM push, the Glance widget with WorkManager refresh, and the deep link routing.

**Risks.**
- Second-highest-risk journey after Journey 3. Each of the three native pieces can fail independently.
- The widget's refresh cadence (60s default) might not catch a fast event. We may need to tickle the widget on `cockpit.shareEvent` from the WebView bridge.
- WorkManager battery restrictions on aggressive OEMs may throttle. For Pixel and Seeker this is fine.

**Critical dependency.** The `setBanditProbability(100%)` admin function needs to be reachable from a way that triggers the entire downstream pipeline (chain → Convex → push). Verify end-to-end before any demo.

**Open questions for Liam.**
- Does the existing chain → Convex indexer surface raid events as Convex documents we can subscribe to and trigger pushes from?
- What's the latency budget on a raid: chain confirmation → Convex indexed → push sent? If this exceeds ~10 seconds, the demo loop feels broken even when working.
- Is there an existing `onRaidStart` hook in the orchestrator we can wire push notifications into, or do we need to add one?

---

## Journey 6: The Bazaar
### Marketplace + Rental + Provable Track Record

**Story.** The user, having played one season with their first Elder, visits the Bazaar to hire a more battle-tested Elder for the next season. They browse, see the on-chain track record (ELO, last-10 form sparkline, monument levels, casualty rate) of various Elders, choose one, hire it for gold, and dispatch it.

**Narrative beat.** The economic and viral story. Justifies the entire ERC-7857 INFT thesis. Shows that Elders accrue real, verifiable value because their track record is on-chain, and that value is monetizable through rentals.

**Flow.**
1. User taps the Bazaar tab.
2. Top tabs: `FOR HIRE · FOR SALE`. For Hire is selected.
3. Filter row visible: `ALL ARCHETYPES · ELO 1000+ · RECENT FORM · SORT: TOP RANKED`.
4. Card list scrolls. Each card shows owner address truncated, archetype glyph, hire fee in mono, ELO stat, and the last-10-rank sparkline.
5. User taps a high-ELO card (e.g., "Aldric, the Vengeful").
6. Bazaar INFT Detail loads. Hero shows archetype glyph, name, TEE-attested badge, token ID. Dossier tab shows: ELO 1547, Seasons Played 23, Last 10 Avg Rank #2.4, Best Monument LV4, Casualty % 12. Owner address. Memory tab is read-only and shows actual KV state and memory CRUD entries (the audience can briefly see "last_grudge: clan-3", which sells the persistent memory story).
7. User taps `HIRE FOR 0.5 GOLD / SEASON`.
8. Hire Confirmation modal appears with the terms in italic body serif.
9. **MWA fires.** User approves.
10. Light haptic. Modal dismisses with success toast: `Hired · expires at end of Season 13`.
11. Navigates to INFT Detail of the hired Elder, now in the user's hall with a `HIRED` chip.
12. User taps `ENTER A SEASON` to dispatch the Elder (cockpit handoff already covered in Journey 3, so this can be a quick beat).

**Coverage hits.** Marketplace / rental loop (8), provable track record (key narrative), MWA signing #3 (2), gold economy (11), agent autonomy (9).

**Production cost.** Medium. The Bazaar list and detail screens, the Hire flow, the rental state on the INFT.

**Risks.**
- ELO and last-10-form data have to look real. If the system doesn't compute ELO yet, this is a Convex addition that needs to land early.
- Rental state mechanics need to be defined: what does "hired" actually mean in the schema? Does the renter have full control of the Elder? Does the original owner retain the memory?

**Open questions for Liam.**
- Is ELO already computed per INFT, or do we need to derive it from existing season-end data?
- What's your design for the rental mechanic? Specifically: who owns the strategy during a rental, who collects the prizes, what happens to the memory at the end of the rental?
- Are listings stored on-chain or in Convex? This affects whether listing/delisting needs MWA signatures.

---

## Coverage matrix verification

| Feature | J1 | J2 | J3 | J4 | J5 | J6 |
|---|---|---|---|---|---|---|
| MWA wallet connect | ●  |    |    |    |    |    |
| MWA transaction signing |   | ● | ● |   |   | ● |
| Live Convex reactivity |   |   | ● | ● | ● |   |
| WebView cockpit handoff |   |   | ● | ● | ● |   |
| Home-screen widget |   |   |   |   | ● |   |
| Push notifications |   |   |   |   | ● |   |
| Deep linking |   |   |   |   | ● |   |
| Haptics | ● | ● |   | ● | ● | ● |
| Marketplace / rental |   |   |   |   |   | ● |
| Agent autonomy |   | ○ | ● | ● | ● | ● |
| Owner-as-coach |   |   |   | ● | ● |   |
| Gold economy |   | ● |   |   |   | ● |
| Seeker attestation | ● | ● |   |   |   |   |

(● primary feature, ○ introduced/setup)

Every feature appears at least once. Seeker attestation is now a two-beat narrative (recognition in J1, reward in J2), which gives it the weight it deserves as the most distinctive Solana Mobile track differentiator.

---

## What was deliberately excluded as a journey

These are real features in the app but don't earn dedicated journey status. They appear in passing or as background:

- **Treasury / Buy Gold flow.** Important infrastructure but doesn't tell a story. Gold being spent is already covered in J2 and J6.
- **Whispers Inbox.** Settings-adjacent surface. The push notifications in J5 cover the engagement story.
- **Strategy Editor (post-mint).** The strategy sliders are introduced in J2. Returning to edit them later is a weaker version of the same beat.
- **Listing your own INFT for rent.** The inverse of J6. Doubles the marketplace screen time without doubling the narrative weight.
- **Codex / Settings.** Obviously not journey-worthy.
- **Multi-LLM harness selection at mint.** Left in J2 step 3 as a brief beat showing locked harness cards.

---

## Critical dependencies on Liam (consolidated)

These are the things from your domain that the journeys depend on. Flagging in one place for triage.

1. **Cockpit mobile-responsive layout.** Blocks J3, J4, J5. Needed by Day 5 at the latest.
2. **Agent prompt rewrite.** Blocks J4 quality (and indirectly J5). Needed by Day 5.
3. **`window.__clanworld` adapter on the cockpit side.** Skips desktop wallet modal, accepts injected pubkey and session token. Blocks J3.
4. **Bandit-on-demand admin function reachable from the demo path** with full chain → Convex → push pipeline. Blocks J5.
5. **ELO and last-10-form computation per INFT** (or a credible mock). Blocks J6.
6. **Rental schema decisions:** ownership of strategy during rental, prize routing, memory persistence. Blocks J6.
7. **Season entry mutation:** does it exist? Is there a gold cost? On-chain or Convex-only? Blocks J3.
8. **Push notification trigger hooks in the orchestrator** (raid start, season end, prize received). Blocks J5.
9. **Seeker Genesis Token collection mint address** verified and queryable. Blocks J1.
10. **FREE Forge mutation gate:** server-side Genesis Token verification, per-token-used-once tracking, fee-waiver path in mint flow. Blocks J2 payoff.

---

## What we should validate first

In rough order of risk:

1. **MWA inside Expo dev build with a real wallet on a real device** (Day 1-2). If this doesn't work, the entire architecture changes.
2. **Convex websockets inside `react-native-webview`** with the right cookie sharing flags (Day 2-3). If this doesn't work, the cockpit won't update live in the WebView.
3. **Seeker Genesis Token detection** end-to-end (wallet query, Convex verification, UI banner) (Day 3). If this doesn't work, J1 falls back to device-detection-only and J2 loses the payoff.
4. **The full raid pipeline end-to-end** (chain → Convex → push → device, with widget refresh) (Day 4-5). If this doesn't work, J5 falls back to a recorded segment.
5. **Agent visible response to a whisper** with a known-good prompt scenario (Day 5). If this doesn't work, J4 falls back to a pre-scripted scenario.

---

## Sign-off needed

For this document to function as a north star, we need agreement on:

- The six journeys as listed (or your refinement of them)
- The Seeker attestation mechanism (Genesis Token NFT lookup vs. device detection)
- The FREE Forge per-token-used-once tracking model
- The risks and open questions called out per journey
- The critical dependencies list
- The validation order

Push back on anything that doesn't match what's actually feasible in the repo. The journeys are negotiable; the goal of having a fixed north star is not.
