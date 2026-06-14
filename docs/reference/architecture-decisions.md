# Architecture Decisions

Validated decisions for active ClanWorld V3 work.

| Decision | Choice | Rationale |
|---|---|---|
| Realm | One Base Sepolia realm | Avoids cross-chain branching and keeps one canonical state surface. |
| Tick cadence | 30s live (owner-settable on-chain via `setHeartbeatIntervalSeconds`) | The dockerized runner has no cadence floor; 30s is the current canonical interval. |
| Heartbeat caller | Dockerized `packages/heartbeat` runner (live + dev), Convex cron as disaster fallback | The runner is the only writer of `heartbeat()`; Convex stays as DR. |
| Indexer trigger | Webhook-primary, poller safety net | Low latency with idempotent recovery. |
| Webhook payload | Minimal chain/address/tx metadata | Convex re-derives state from chain instead of trusting payload state. |
| Convex deployment | Single active V3 deployment | One realm and one frontend target. |
| Frontend access | Direct browser URL | The app renders directly without platform-specific gates. |
| Agent memory | File-backed interim, Walrus next | Keeps continuity live while the storage backend is swapped in. |

Update this file when a decision changes. Old hackathon material belongs under
`docs/archive/`, not in active guidance.
