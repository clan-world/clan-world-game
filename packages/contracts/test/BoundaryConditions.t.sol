// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Test} from "forge-std/Test.sol";
import {ClanWorld} from "../src/ClanWorld.sol";
import {
    ClanWorldConstants,
    ActionType,
    ClanState,
    ClansmanState,
    BanditState,
    Clan,
    Clansman,
    Mission,
    BanditTroop,
    ClanOrder,
    OrderResult,
    WorldState
} from "../src/IClanWorld.sol";

/// @dev Harness exposes internals needed to drive boundary states without
///      running thousands of heartbeats (uint64 overflow tests would otherwise
///      need ~1.8e19 heartbeat() calls).
contract BoundaryHarness is ClanWorld {
    function setCurrentTickForTest(uint64 tick) external {
        _world.currentTick = tick;
        _world.nextHeartbeatAtTick = tick + 1;
        _world.nextHeartbeatAtTs = 0;
        _world.currentTickSeed = keccak256(abi.encode("test-seed", tick));
        // Note: cannot set _tickSeeds[tick] from harness (private mapping).
        // isWinter() does not depend on the tick seed; only on currentTick.
    }

}

/// @notice Tests boundary conditions for tick math, winter cycle, upgrade level
///         enums, action duration enum coverage, travel-distance region edges,
///         heartbeat rate-limit timestamps, and default-vs-explicit mapping
///         reads on unset keys.
///
///         Focus per Agent B brief (2026-05-24): uint64 edges
///         (type(uint64).max clamping), block.timestamp boundaries (=, -1, +1
///         at heartbeat rate-limit), time-based state transitions (winter at
///         exact tick 109/110/119/120), integer enum-table boundaries (level
///         0/MAX/MAX+1), array length 0, mapping default-0 vs explicit-set.
contract BoundaryConditionsTest is Test {
    BoundaryHarness world;
    address elder = address(0xA1);

    function setUp() public {
        world = new BoundaryHarness();
    }

    // =========================================================================
    // 1) _addTicksClamped uint64 saturation is intentionally NOT covered here.
    //    The private `_addTicksClamped` saturating-add branch is unreachable
    //    through any public entry point: the submitClanOrders backlog guard
    //    (`lastSettled + 200` in checked 0.8 arithmetic) reverts on overflow
    //    whenever currentTick > type(uint64).max - 200, so the clamp can never
    //    fire in production. A harness mirror of the algorithm was removed
    //    (codex R1, 2026-06-14) because re-implementing the function in-test
    //    only proves the mirror, not the production path = test theater.
    //    The reachable (non-clamp) path is exercised by the real order/mission
    //    settlement suites (MissionTiming, Gathering, HeartbeatOrdering, etc.),
    //    which assert settlesAtTick/arrivalTick == base + duration via the
    //    live _addTicksClamped call.
    // =========================================================================

    // =========================================================================
    // 2) Winter cycle boundary ticks
    //    WINTER_START_TICK = 110, WINTER_DURATION_TICKS = 10, PERIOD = 110.
    //    Active when (tick - 110) % 110 < 10 (and tick >= 110).
    //    Edges: 109 (no), 110 (yes), 119 (yes — last active), 120 (no),
    //           219 (no), 220 (yes — 2nd winter), 229 (yes), 230 (no).
    // =========================================================================

    function test_isWinterActiveAtExactBoundaryTicks() public {
        // tick 109: one before winter starts — not winter
        world.setCurrentTickForTest(109);
        assertFalse(world.isWinter(), "tick 109: pre-winter runway, not active");

        // tick 110: first tick of winter
        world.setCurrentTickForTest(110);
        assertTrue(world.isWinter(), "tick 110: winter starts");

        // tick 119: last tick of winter (110+9, since duration=10)
        world.setCurrentTickForTest(119);
        assertTrue(world.isWinter(), "tick 119: still winter (last active tick)");

        // tick 120: winter ended
        world.setCurrentTickForTest(120);
        assertFalse(world.isWinter(), "tick 120: winter ended");

        // tick 219: one before 2nd winter starts (110 + 110 - 1)
        world.setCurrentTickForTest(219);
        assertFalse(world.isWinter(), "tick 219: between winters");

        // tick 220: 2nd winter starts
        world.setCurrentTickForTest(220);
        assertTrue(world.isWinter(), "tick 220: second winter starts");

        // tick 229: last tick of 2nd winter
        world.setCurrentTickForTest(229);
        assertTrue(world.isWinter(), "tick 229: second winter last active tick");

        // tick 230: ends
        world.setCurrentTickForTest(230);
        assertFalse(world.isWinter(), "tick 230: second winter ended");
    }

    function test_isWinterFalseAtTickZero() public view {
        // Mapping default vs explicit-set: at construction currentTick=0, no winter
        WorldState memory ws = world.getWorldState();
        assertEq(ws.currentTick, 0, "construction sets tick=0");
        assertFalse(world.isWinter(), "tick 0: never winter");
    }

    // =========================================================================
    // 3) Upgrade cost level-table boundaries (level 0, 1..MAX-1, MAX, MAX+1, 255)
    //    Wall: levels 0..4 cost something; >=5 (MAX) returns (0,0)
    //    Base: levels 1..4 cost something; >=5 returns zeros; level 0 also (0,0,0)
    //    Monument: levels 0..5 cost; 6..9 cost (200,25,100,1); >=10 (MAX) (0,0,0,0)
    // =========================================================================

    function test_wallUpgradeCostAtLevelBoundaries() public view {
        // level 0 (initial)
        (uint256 wood0, uint256 iron0) = world.getWallUpgradeCost(0);
        assertEq(wood0, 20e18, "wall L0 wood");
        assertEq(iron0, 0, "wall L0 iron");

        // level 4 (last upgradable)
        (uint256 wood4, uint256 iron4) = world.getWallUpgradeCost(4);
        assertEq(wood4, 50e18, "wall L4 wood (last upgrade)");
        assertEq(iron4, 15e18, "wall L4 iron");

        // level 5 (MAX — already maxed, no further upgrade)
        (uint256 wood5, uint256 iron5) = world.getWallUpgradeCost(5);
        assertEq(wood5, 0, "wall L5=MAX returns zero cost");
        assertEq(iron5, 0, "wall L5=MAX returns zero cost");

        // level 6 (above MAX — out of table, defensive zero)
        (uint256 wood6, uint256 iron6) = world.getWallUpgradeCost(6);
        assertEq(wood6, 0, "wall L6 above-MAX returns zero cost");
        assertEq(iron6, 0, "wall L6 above-MAX returns zero cost");

        // uint8 max — should not revert, returns defensive zero
        (uint256 woodMax, uint256 ironMax) = world.getWallUpgradeCost(type(uint8).max);
        assertEq(woodMax, 0, "wall L=uint8.max safe zero");
        assertEq(ironMax, 0, "wall L=uint8.max safe zero");
    }

    function test_baseUpgradeCostAtLevelBoundaries() public view {
        // level 0 — note: real base starts at level 1 post-mint, so 0 returns zeros (defensive)
        (uint256 wood0, uint256 iron0, uint256 wheat0) = world.getBaseUpgradeCost(0);
        assertEq(wood0, 0, "base L0 zero (defensive: never upgraded from 0)");
        assertEq(iron0, 0, "base L0 zero");
        assertEq(wheat0, 0, "base L0 zero");

        // level 4 — last upgradable
        (uint256 wood4, uint256 iron4, uint256 wheat4) = world.getBaseUpgradeCost(4);
        assertEq(wood4, 100e18, "base L4 wood");
        assertEq(iron4, 15e18, "base L4 iron");
        assertEq(wheat4, 50e18, "base L4 wheat");

        // level 5 = MAX
        (uint256 wood5, uint256 iron5, uint256 wheat5) = world.getBaseUpgradeCost(5);
        assertEq(wood5, 0, "base L5=MAX zero");
        assertEq(iron5, 0, "base L5=MAX zero");
        assertEq(wheat5, 0, "base L5=MAX zero");

        // uint8 max
        (uint256 woodMax,,) = world.getBaseUpgradeCost(type(uint8).max);
        assertEq(woodMax, 0, "base L=uint8.max safe zero");
    }

    function test_monumentUpgradeCostAtLevelBoundaries() public view {
        // level 0
        (uint256 wood0, uint256 iron0, uint256 wheat0, uint256 bp0) = world.getMonumentUpgradeCost(0);
        assertEq(wood0, 30e18, "mon L0 wood");
        assertEq(iron0, 0, "mon L0 iron");
        assertEq(wheat0, 20e18, "mon L0 wheat");
        assertEq(bp0, 0, "mon L0 blueprint");

        // level 5 — last of "early" tier
        (uint256 wood5, uint256 iron5, uint256 wheat5, uint256 bp5) = world.getMonumentUpgradeCost(5);
        assertEq(wood5, 150e18, "mon L5 wood");
        assertEq(iron5, 20e18, "mon L5 iron");
        assertEq(wheat5, 80e18, "mon L5 wheat");
        assertEq(bp5, 0, "mon L5 blueprint=0 (no BP yet)");

        // level 6 — first BP-requiring level (table: 200,25,100,1 for [6..9])
        (uint256 wood6, uint256 iron6, uint256 wheat6, uint256 bp6) = world.getMonumentUpgradeCost(6);
        assertEq(wood6, 200e18, "mon L6 wood");
        assertEq(iron6, 25e18, "mon L6 iron");
        assertEq(wheat6, 100e18, "mon L6 wheat");
        assertEq(bp6, 1e18, "mon L6 blueprint=1 (first BP tier)");

        // level 9 — last BP-requiring level (10 is MAX)
        (uint256 wood9, uint256 iron9, uint256 wheat9, uint256 bp9) = world.getMonumentUpgradeCost(9);
        assertEq(wood9, 200e18, "mon L9 wood (same as L6)");
        assertEq(iron9, 25e18, "mon L9 iron");
        assertEq(wheat9, 100e18, "mon L9 wheat");
        assertEq(bp9, 1e18, "mon L9 blueprint=1");

        // level 10 = MAX
        (uint256 wood10, uint256 iron10, uint256 wheat10, uint256 bp10) = world.getMonumentUpgradeCost(10);
        assertEq(wood10, 0, "mon L10=MAX zero");
        assertEq(iron10, 0, "mon L10=MAX zero");
        assertEq(wheat10, 0, "mon L10=MAX zero");
        assertEq(bp10, 0, "mon L10=MAX zero");

        // level 11 — above MAX
        (uint256 wood11,,,) = world.getMonumentUpgradeCost(11);
        assertEq(wood11, 0, "mon L11 above-MAX zero");

        // uint8 max — defensive
        (uint256 woodMax,,, uint256 bpMax) = world.getMonumentUpgradeCost(type(uint8).max);
        assertEq(woodMax, 0, "mon L=uint8.max safe zero");
        assertEq(bpMax, 0, "mon L=uint8.max safe zero");
    }

    // =========================================================================
    // 4) getActionDuration full enum coverage — boundary at None (0) and at
    //    every non-gather/non-build action that returns 0.
    // =========================================================================

    function test_getActionDurationEnumBoundaries() public view {
        // None: index 0, returns 0
        assertEq(world.getActionDuration(ActionType.None), 0, "None=0");
        // Gathering: 4 ticks each
        assertEq(world.getActionDuration(ActionType.ChopWood), 4, "ChopWood=4");
        assertEq(world.getActionDuration(ActionType.MineIron), 4, "MineIron=4");
        assertEq(world.getActionDuration(ActionType.FishDocks), 4, "FishDocks=4");
        assertEq(world.getActionDuration(ActionType.FishDeepSea), 4, "FishDeepSea=4");
        assertEq(world.getActionDuration(ActionType.HarvestWheat), 4, "HarvestWheat=4");
        // Deposit/Withdraw share DEPOSIT_DURATION_TICKS
        uint64 depositDur = world.getActionDuration(ActionType.DepositResources);
        assertEq(world.getActionDuration(ActionType.WithdrawResources), depositDur, "Withdraw == Deposit duration");
        assertGt(depositDur, 0, "Deposit duration must be non-zero");
        // Upgrade actions share BUILDING_DURATION_TICKS
        uint64 buildDur = world.getActionDuration(ActionType.UpgradeWall);
        assertEq(world.getActionDuration(ActionType.UpgradeBase), buildDur, "UpgradeBase == UpgradeWall duration");
        assertEq(world.getActionDuration(ActionType.UpgradeMonument), buildDur, "UpgradeMonument == UpgradeWall duration");
        assertGt(buildDur, 0, "Building duration must be non-zero");
        // Market actions: 1 tick
        assertEq(world.getActionDuration(ActionType.MarketBuy), 1, "MarketBuy=1");
        assertEq(world.getActionDuration(ActionType.MarketSell), 1, "MarketSell=1");
        // Defend & Wait & (implicit catch-all): 0
        assertEq(world.getActionDuration(ActionType.DefendBase), 0, "DefendBase=0");
        assertEq(world.getActionDuration(ActionType.Wait), 0, "Wait=0");
    }

    // =========================================================================
    // 5) getTravelTicks region boundary — region 0 (NOOP sentinel), same
    //    region, region > 8 (out of range — defensive 0).
    // =========================================================================

    function test_getTravelTicksRegionBoundaries() public view {
        // Same region: 0 ticks
        assertEq(
            world.getTravelTicks(ClanWorldConstants.REGION_FOREST, ClanWorldConstants.REGION_FOREST),
            0,
            "same region (Forest->Forest) = 0"
        );

        // NOOP sentinel (region 0) either side
        assertEq(world.getTravelTicks(0, ClanWorldConstants.REGION_FOREST), 0, "from=NOOP returns 0");
        assertEq(world.getTravelTicks(ClanWorldConstants.REGION_FOREST, 0), 0, "to=NOOP returns 0");
        assertEq(world.getTravelTicks(0, 0), 0, "both NOOP returns 0");

        // Out of range (>8) — defensive 0
        assertEq(world.getTravelTicks(9, ClanWorldConstants.REGION_FOREST), 0, "from=9 (out-of-range) returns 0");
        assertEq(world.getTravelTicks(ClanWorldConstants.REGION_FOREST, 9), 0, "to=9 (out-of-range) returns 0");
        assertEq(world.getTravelTicks(type(uint8).max, type(uint8).max), 0, "both uint8.max returns 0");

        // Known-good corner: Forest(1) -> DeepSea(8) is the longest path at 3 hops
        assertEq(
            world.getTravelTicks(ClanWorldConstants.REGION_FOREST, ClanWorldConstants.REGION_DEEP_SEA),
            3,
            "Forest->DeepSea=3 hops"
        );
        // And EastDocks(7) -> Forest(1) is the absolute max at 4
        assertEq(
            world.getTravelTicks(ClanWorldConstants.REGION_EAST_DOCKS, ClanWorldConstants.REGION_FOREST),
            4,
            "EastDocks->Forest=4 hops (max)"
        );
    }

    // =========================================================================
    // 6) Heartbeat rate-limit timestamp boundary — block.timestamp ==
    //    nextHeartbeatAtTs must succeed (>=), == nextHeartbeatAtTs - 1 must
    //    revert. Uses real heartbeat (no harness) so we exercise the
    //    production guard.
    // =========================================================================

    function test_heartbeatRevertsOneSecondBeforeBoundary() public {
        ClanWorld realWorld = new ClanWorld();
        WorldState memory ws = realWorld.getWorldState();
        uint64 nextTs = ws.nextHeartbeatAtTs;
        // Constructor sets nextHeartbeatAtTs = block.timestamp, so the first
        // call must succeed immediately. Run that first to advance the guard.
        realWorld.heartbeat();
        ws = realWorld.getWorldState();
        nextTs = ws.nextHeartbeatAtTs;
        // Now warp to nextTs - 1 and expect revert.
        vm.warp(nextTs - 1);
        vm.expectRevert("ClanWorld: heartbeat rate limited");
        realWorld.heartbeat();
    }

    function test_heartbeatSucceedsAtExactBoundary() public {
        ClanWorld realWorld = new ClanWorld();
        realWorld.heartbeat(); // consume the freebie
        WorldState memory ws = realWorld.getWorldState();
        uint64 nextTs = ws.nextHeartbeatAtTs;
        // Warp to EXACTLY nextHeartbeatAtTs — boundary inclusive.
        vm.warp(nextTs);
        realWorld.heartbeat();
        ws = realWorld.getWorldState();
        assertGe(ws.currentTick, 2, "second heartbeat should have closed at least tick 1, advancing to 2");
    }

    // =========================================================================
    // 7) Mapping default-zero vs explicit-set for unminted IDs.
    //    Solidity returns zeroed structs for unset mapping keys. Verify the
    //    public getters do not revert and return the "empty" shape callers
    //    expect, distinguished from a real entity by clanId/clansmanId==0
    //    or BanditState.None.
    // =========================================================================

    function test_getClanForUnmintedIdReturnsZeroedStruct() public view {
        // Clan IDs start at 1; ID 0 is sentinel CLAN_ID_NULL. ID 9999 has
        // never been minted.
        Clan memory c0 = world.getClan(0);
        assertEq(c0.clanId, 0, "unminted clanId=0 returns default-zero");
        assertEq(uint8(c0.clanState), uint8(ClanState.ACTIVE), "default ClanState = first enum value");
        assertEq(c0.vaultWood, 0, "vault wood = 0");
        assertEq(c0.goldBalance, 0, "gold balance = 0");

        Clan memory c9999 = world.getClan(9999);
        assertEq(c9999.clanId, 0, "high-unminted clanId=0");
        assertEq(c9999.owner, address(0), "high-unminted owner=address(0)");
        assertEq(c9999.livingClansmen, 0, "high-unminted living=0");
    }

    function test_getClansmanForUnmintedIdReturnsZeroedStruct() public view {
        Clansman memory cs = world.getClansman(0);
        assertEq(cs.clansmanId, 0, "unminted clansmanId=0");
        assertEq(uint8(cs.state), uint8(ClansmanState.WAITING), "default ClansmanState = first enum");
        assertEq(cs.currentRegion, 0, "current region default 0 (NOOP)");

        Clansman memory cs9999 = world.getClansman(9999);
        assertEq(cs9999.clansmanId, 0, "high-unminted clansmanId=0");
    }

    function test_getActiveMissionForUnmintedClansmanReturnsInactive() public view {
        Mission memory m = world.getActiveMission(0);
        assertEq(m.active, false, "unminted clansman: mission not active");
        assertEq(m.submittedAtTick, 0, "submittedAtTick default 0");
        assertEq(m.settlesAtTick, 0, "settlesAtTick default 0");
        assertEq(uint8(m.action), uint8(ActionType.None), "default action = None");
    }

    function test_getBanditForUnmintedIdNormalizesToEmptyShape() public view {
        // ClanWorld.getBandit() has an explicit normalizer: when banditId is null
        // OR state == None, it returns a fully-zeroed BanditTroop. Verify the
        // shape callers depend on.
        BanditTroop memory b = world.getBandit(0);
        assertEq(b.id, 0, "bandit id 0 -> normalized id=0");
        assertEq(uint8(b.state), uint8(BanditState.None), "state None");
        assertEq(b.region, 0, "region 0");
        assertEq(b.strength, 0, "strength 0");
        assertEq(b.carryGold, 0, "carryGold 0");

        BanditTroop memory b99 = world.getBandit(99999);
        assertEq(b99.id, 0, "high-unminted -> normalized id=0");
        assertEq(uint8(b99.state), uint8(BanditState.None), "state None");
    }

    function test_getBanditsInRegionEmptyRegionReturnsEmptyArray() public view {
        // No bandits ever spawned; every region should give length-0 array.
        for (uint8 region = 0; region <= 8; region++) {
            uint32[] memory ids = world.getBanditsInRegion(region);
            assertEq(ids.length, 0, "no bandits anywhere -> empty array");
        }
    }

    // =========================================================================
    // 8) Array length 0 boundaries: getRankings, getClanIds, getActiveDefenders,
    //    submitClanOrders(empty array). All must return length-0 (or revert
    //    where the contract states ownership requirements).
    // =========================================================================

    function test_getRankingsAndClanIdsEmptyWhenNoClans() public view {
        (uint32[] memory ranked, uint256[] memory scores) = world.getRankings();
        assertEq(ranked.length, 0, "no clans -> empty rankings");
        assertEq(scores.length, 0, "no clans -> empty scores");
        assertEq(ranked.length, scores.length, "ranked/scores length must match");

        uint32[] memory ids = world.getClanIds();
        assertEq(ids.length, 0, "no clans -> empty getClanIds");
    }

    function test_getActiveDefendersForUnknownClanReturnsEmpty() public view {
        uint32[] memory defenders = world.getActiveDefenders(0);
        assertEq(defenders.length, 0, "clan 0 (unknown): no defenders");
        uint32[] memory defenders99 = world.getActiveDefenders(99999);
        assertEq(defenders99.length, 0, "high-unknown clan: no defenders");
    }

    function test_submitClanOrdersWithEmptyArrayReturnsEmptyResults() public {
        // Mint a real clan so ownership check passes.
        vm.prank(elder);
        (uint32 clanId,) = world.mintClan(elder);

        ClanOrder[] memory orders = new ClanOrder[](0);
        vm.prank(elder);
        OrderResult[] memory results = world.submitClanOrders(clanId, orders);
        assertEq(results.length, 0, "empty orders -> empty results (no revert)");
    }

    function test_getClanClansmanIdsForUnmintedClanReturnsEmpty() public view {
        uint32[] memory ids = world.getClanClansmanIds(0);
        assertEq(ids.length, 0, "clan 0 unminted: no clansmen");
        uint32[] memory ids99 = world.getClanClansmanIds(99999);
        assertEq(ids99.length, 0, "high-unminted clan: no clansmen");
    }

    function test_getMonumentLevelReachedAtUnmintedClanReturnsZero() public view {
        // Default-zero on a 2D mapping[clanId][level] should NOT revert.
        for (uint8 level = 0; level <= 10; level++) {
            assertEq(world.getMonumentLevelReachedAt(99999, level), 0, "unminted clan, all levels = 0");
        }
    }

}
