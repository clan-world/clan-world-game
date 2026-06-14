// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Test} from "forge-std/Test.sol";
import {ClanWorld} from "../src/ClanWorld.sol";
import {
    ClanWorldConstants,
    ActionType,
    ClansmanState,
    StatusCode,
    Clansman,
    Mission,
    ClanFullView,
    ClanOrder,
    WithdrawResourcesData,
    OrderResult
} from "../src/IClanWorld.sol";

/// @notice HACKATHON proof test: asserts the gather yields are DOUBLED using
///         ABSOLUTE expected values (independent of the constant being read),
///         so it proves the deployed bytecode actually produces 2e18 WOOD/tick
///         etc. — not a circular `== constant` tautology.
contract HackathonGather2xTest is Test {
    ClanWorld world;
    address elder = address(0xA1);

    function setUp() public {
        world = new ClanWorld();
    }

    function _advanceTick() internal {
        vm.warp(world.getWorldState().nextHeartbeatAtTs);
        world.heartbeat();
    }

    function _advanceUntilCurrentTick(uint64 targetTick) internal {
        while (world.getWorldState().currentTick < targetTick) {
            _advanceTick();
        }
    }

    function _mintClan() internal returns (uint32 clanId) {
        vm.prank(elder);
        (clanId,) = world.mintClan(elder);
    }

    function _firstCs(uint32 clanId) internal view returns (uint32) {
        ClanFullView memory v = world.getClanFullView(clanId);
        return v.clansmen[0].clansman.clansman.clansmanId;
    }

    function _settle(uint32 clanId, uint32 csId, ActionType action, uint8 region)
        internal
        returns (Clansman memory)
    {
        ClanOrder[] memory orders = new ClanOrder[](1);
        orders[0] = ClanOrder({
            clansmanId: csId,
            gotoRegion: region,
            action: action,
            targetClanId: 0,
            marketToken: address(0),
            marketAmount: 0,
            maxGoldIn: 0,
            withdrawResources: WithdrawResourcesData({wood: 0, iron: 0, wheat: 0, fish: 0})
        });
        vm.prank(elder);
        OrderResult[] memory result = world.submitClanOrders(clanId, orders);
        assertEq(uint8(result[0].status), uint8(StatusCode.OK), "order accepted");

        Mission memory mission = world.getActiveMission(csId);
        _advanceUntilCurrentTick(mission.settlesAtTick + 1);
        world.settleClan(clanId);
        return world.getClansman(csId);
    }

    /// @dev HEARTBEAT_INTERVAL is 30s (ClanWorldConstants.HEARTBEAT_INTERVAL_SECONDS),
    ///      so a single tick advance schedules the next heartbeat exactly 30s out.
    function test_heartbeatIntervalIs30() public {
        assertEq(world.heartbeatIntervalSeconds(), 30, "interval == 30");
        uint64 before = world.getWorldState().nextHeartbeatAtTs;
        vm.warp(before);
        world.heartbeat();
        uint64 after_ = world.getWorldState().nextHeartbeatAtTs;
        assertEq(after_, uint64(block.timestamp) + 30, "next heartbeat is +30s");
    }

    /// @dev WOOD non-crit yield is now 2e18/tick (was 1e18). Use prevrandao
    ///      that yields a NON-crit roll so the absolute value is deterministic.
    function test_woodYieldDoubled() public {
        vm.prevrandao(bytes32(uint256(1)));
        uint32 clanId = _mintClan();
        uint32 csId = _firstCs(clanId);
        Clansman memory cs = _settle(clanId, csId, ActionType.ChopWood, ClanWorldConstants.REGION_FOREST);

        uint256 dur = uint256(world.getActionDuration(ActionType.ChopWood));
        // Either non-crit (2e18*dur) or crit (2x that). Both prove doubling vs the
        // old 1e18 base. Assert it is one of the two doubled values.
        assertTrue(
            cs.carryWood == 2e18 * dur || cs.carryWood == 4e18 * dur,
            "wood yield is doubled (2e18 or crit 4e18 per tick)"
        );
        // Critically: it must NOT equal the old base (1e18*dur) unless capped.
        if (cs.carryWood < ClanWorldConstants.WOOD_CAP) {
            assertTrue(cs.carryWood != 1e18 * dur, "wood yield must not be old 1e18 base");
        }
    }

    /// @dev WHEAT yield is now 10e18/tick (was 5e18).
    function test_wheatYieldDoubled() public {
        uint32 clanId = _mintClan();
        uint32 csId = _firstCs(clanId);
        Clansman memory cs =
            _settle(clanId, csId, ActionType.HarvestWheat, ClanWorldConstants.REGION_WEST_FARMS);

        uint256 dur = uint256(world.getActionDuration(ActionType.HarvestWheat));
        if (cs.carryWheat < ClanWorldConstants.WHEAT_CAP) {
            assertEq(cs.carryWheat, 10e18 * dur, "wheat yield is 10e18/tick (doubled)");
        }
    }
}
