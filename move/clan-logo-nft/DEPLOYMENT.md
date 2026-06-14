# ClanWorld Logo NFT — mainnet deployment

Deployed 2026-06-13 (hackathon). Free public mint; image served from Walrus.

## On-chain IDs (Sui mainnet)
| Thing | ID |
|-------|----|
| **Package** | `0xe7761942e5dab75ba7fd9b6b1a21e5e5fea092f816f0bbb3d45e2b59366554c1` |
| Module::function (mint) | `clan_logo_nft::mint` |
| Display object | `0x63a9ab30e44b14014d6f5ce7c8a17614d216d5e59a958fd3c07b0554c3ecf399` |
| Publisher | `0xe8bf8db91cca8fc7efef022f0d5c30d3fb7283a715d8a7b406f724deed9340d4` |
| UpgradeCap | `0xa24e62b15efcfd37e852973b10931624a3bc53589601586db4851941fc9bbcf7` |
| First test NFT (owned by deployer) | `0x076716923d9dc71ecb45df77819c717ff8d66b3beb5a39f3467eaae1d5ed6dea` |
| Deployer wallet | `0xa607735e95142e8540b17f055cbf55f48e24c99f847949b13989985ebcdf2b96` |

## Image (Walrus)
- Blob ID: `9uCKVZktCJPMjm6vyZS1ayPSTh9B5yLU5dSs-2AFLdw`
- URL: `https://aggregator.walrus-mainnet.walrus.space/v1/blobs/9uCKVZktCJPMjm6vyZS1ayPSTh9B5yLU5dSs-2AFLdw`
- Source: `images/square-logo-main.png`, stored --epochs 53 (~2yr)

## Mint (CLI)
```bash
sui client call \
  --package 0xe7761942e5dab75ba7fd9b6b1a21e5e5fea092f816f0bbb3d45e2b59366554c1 \
  --module clan_logo_nft --function mint --gas-budget 20000000
```
Mints one NFT to the signer. For the free-mint mini-app, the dApp calls the same `::clan_logo_nft::mint` target.

## Set as SuiNS avatar for clanworld.sui
1. The NFT must be owned by the wallet that owns `clanworld.sui`. Mint/transfer one to that wallet.
2. suins.io → connect that wallet → View names you own → `...` menu on `clanworld` → Personalize Avatar → select the NFT → Update Avatar.
