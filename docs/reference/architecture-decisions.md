# Architecture Decisions

Validated decisions for active ClanWorld V3 work.

| Decision | Choice | Rationale |
|---|---|---|
| Realm | One Base Sepolia realm | Avoids cross-chain branching and keeps one canonical state surface. |
| Tick cadence | 60s live, faster only for local/dev loops | KeeperHub live cadence is minute-scale; local loops can accelerate demos. |
| Heartbeat caller | KeeperHub live, runner/foundry loop for dev, Convex cron as disaster fallback | Keeps the live path external while preserving a simple recovery path. |
| Indexer trigger | Webhook-primary, poller safety net | Low latency with idempotent recovery. |
| Webhook payload | Minimal chain/address/tx metadata | Convex re-derives state from chain instead of trusting payload state. |
| Convex deployment | Single active V3 deployment | One realm and one frontend target. |
| Frontend access | Direct browser URL | The app renders directly without platform-specific gates. |
| Agent memory | File-backed interim, Walrus next | Keeps continuity live while the storage backend is swapped in. |

Update this file when a decision changes. Old hackathon material belongs under
`docs/archive/`, not in active guidance.
