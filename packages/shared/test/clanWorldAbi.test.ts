import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { iClanWorldAbi } from '@clan-world/contract-types';
import { decodeFunctionResult, encodeAbiParameters, getAbiItem, type Abi, type AbiFunction } from 'viem';
import { CLAN_WORLD_ABI } from '../src/adapters/IChainClient';

const ZERO_BYTES32 = `0x${'00'.repeat(32)}` as `0x${string}`;
// Widening annotation (not cast) — `satisfies Abi` preserves the deep literal union
// and causes TypeScript instantiation-depth errors inside getAbiItem. The structural
// assignment is type-checked by the compiler; if any ABI entry were malformed, tsc fails.
const abi: Abi = iClanWorldAbi;

const getFunctionOutputs = (name: string) => (getAbiItem({ abi, name }) as AbiFunction).outputs;
const worldStateOutputs = getFunctionOutputs('getWorldState');
const worldSnapshotOutputs = getFunctionOutputs('getWorldSnapshot');

describe('ClanWorld generated ABI tuple decoding', () => {
  it('keeps WallDamagedByBandit ticker synced to the ABI newLevel field', () => {
    const event = iClanWorldAbi.find(
      (item) => item.type === 'event' && item.name === 'WallDamagedByBandit',
    );
    const inputNames = event?.inputs.map((input) => input.name) ?? [];

    expect(inputNames).toContain('newLevel');
    expect(inputNames).not.toContain('wallLevel');

    const tickerSource = readFileSync(
      new URL('../../../apps/web/src/EventTicker.tsx', import.meta.url),
      'utf8',
    );
    const wallDamageCase =
      tickerSource.match(/case 'WallDamagedByBandit': \{([\s\S]*?)\n    \}/)?.[1] ?? '';

    expect(wallDamageCase).toContain('args.newLevel');
    expect(wallDamageCase).not.toContain('args.wallLevel');
  });

  it('decodes a known-good getWorldState() result with the current Solidity order', () => {
    const data = encodeAbiParameters(worldStateOutputs, [
      {
        currentTick: 11n,
        seasonStartTick: 1n,
        seasonEndTick: 360n,
        seasonFinalized: false,
        worldPaused: false,
        pausedAtTs: 0n,
        currentSeasonNumber: 7n,
        nextHeartbeatAtTick: 12n,
        nextHeartbeatAtTs: 1_900_000_001n,
        nextBanditSpawnEligibleTick: 21n,
        currentBanditSpawnChanceBps: 3000,
        currentTickSeed: ZERO_BYTES32,
        activeBanditId: 42,
        winterActive: true,
        winterStartsAtTick: 100n,
        winterEndsAtTick: 110n,
        nextCommitSequence: 9n,
      },
    ]);

    const state = decodeFunctionResult({
      abi: CLAN_WORLD_ABI,
      functionName: 'getWorldState',
      data,
    }) as Record<string, unknown>;

    expect(state.currentSeasonNumber).toBe(7n);
    expect(state.nextHeartbeatAtTick).toBe(12n);
    expect(state.nextHeartbeatAtTs).toBe(1_900_000_001n);
    expect(state.winterActive).toBe(true);
  });

  it('decodes a known-good getWorldSnapshot() result with season fields before winter fields', () => {
    const data = encodeAbiParameters(worldSnapshotOutputs, [
      {
        currentTick: 33n,
        seasonStartTick: 0n,
        seasonEndTick: 360n,
        seasonFinalized: false,
        worldPaused: false,
        pausedAtTs: 0n,
        currentSeasonNumber: 2n,
        nextHeartbeatAtTick: 34n,
        winterActive: true,
        winterStartsAtTick: 100n,
        winterEndsAtTick: 110n,
        activeBanditId: 3,
        currentTickSeed: ZERO_BYTES32,
        leaderboard: [],
      },
    ]);

    const snapshot = decodeFunctionResult({
      abi: CLAN_WORLD_ABI,
      functionName: 'getWorldSnapshot',
      data,
    }) as Record<string, unknown>;

    expect(snapshot.currentSeasonNumber).toBe(2n);
    expect(snapshot.nextHeartbeatAtTick).toBe(34n);
    expect(snapshot.winterActive).toBe(true);
    expect(snapshot.activeBanditId).toBe(3);
  });
});
