# Base Sepolia Deployment Runbook

## Diamond Deploy

The diamond deploy is large and sends many transactions. Always run the broadcast with `--slow` so Foundry waits for each transaction before submitting the next one:

```bash
cd packages/contracts
forge script script/Deploy.s.sol \
  --rpc-url "$RPC_URL_PRIMARY" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --slow
```

## Demo Heartbeat Cadence

For the live Base Sepolia demo, set the diamond heartbeat guard to `1` second after deploying or upgrading `HeartbeatFacet`:

```bash
cast send "$CLAN_WORLD_CONTRACT_ADDRESS" \
  "setHeartbeatIntervalSeconds(uint64)" 1 \
  --rpc-url "$RPC_URL_PRIMARY" \
  --private-key "$DEPLOYER_PRIVATE_KEY"

cast call "$CLAN_WORLD_CONTRACT_ADDRESS" \
  "heartbeatIntervalSeconds()(uint64)" \
  --rpc-url "$RPC_URL_PRIMARY"
```

The unset/default cadence remains `60` seconds. The `1` second setting is for manual test cycles and the hackathon demo only.

## Convex Heartbeat Webhook

Convex queries use the `.convex.cloud` URL, but HTTP actions are served from `.convex.site`. Prefer setting `CONVEX_WEBHOOK_URL` explicitly. If it is unset, the TypeScript runner derives it from `CONVEX_DEPLOY_URL` by replacing `.convex.cloud` with `.convex.site` and logs a deprecation warning:

```bash
CONVEX_DEPLOY_URL=https://oceanic-hound-951.convex.cloud
CONVEX_WEBHOOK_URL=https://oceanic-hound-951.convex.site
```

Posting heartbeat txs to `.convex.cloud/api/heartbeat-webhook` returns `404` and will not update `chainEvents`.

## Demo Mission Cooldown

For rapid manual testing, set the clansman submit cooldown to `1` second after deploying or upgrading `HeartbeatConfigFacet`:

```bash
cast send "$CLAN_WORLD_CONTRACT_ADDRESS" \
  "setClansmanCooldownSeconds(uint64)" 1 \
  --rpc-url "$RPC_URL_PRIMARY" \
  --private-key "$DEPLOYER_PRIVATE_KEY"

cast call "$CLAN_WORLD_CONTRACT_ADDRESS" \
  "clansmanCooldownSeconds()(uint64)" \
  --rpc-url "$RPC_URL_PRIMARY"
```

The unset/default cooldown remains `60` seconds.

## Force Next Bandit Spawn

For demo setup, the owner can arm a one-shot forced bandit spawn. This sets the spawn preview to `10000` bps and bypasses the normal bandit spawn cooldown for the next heartbeat only:

```bash
cast send "$CLAN_WORLD_CONTRACT_ADDRESS" \
  "triggerBanditSpawn()" \
  --rpc-url "$RPC_URL_PRIMARY" \
  --private-key "$DEPLOYER_PRIVATE_KEY"

cast call "$CLAN_WORLD_CONTRACT_ADDRESS" \
  "banditSpawnTriggered()(bool)" \
  --rpc-url "$RPC_URL_PRIMARY"
```
