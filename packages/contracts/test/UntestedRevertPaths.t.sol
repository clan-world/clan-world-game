// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

// =============================================================================
// UntestedRevertPaths.t.sol
//
// Agent A — parallel test-improvement experiment (2026-05-24).
// Hunts UNTESTED REVERT PATHS in the monolithic ClanWorld contract:
//   - World pause / unpause access-control + state-machine reverts
//   - Admin recovery (reviveDeadClansmen / reviveClansman / injectClanResources)
//     access-control + custom-error not-found paths
//   - Treasury init double-init guard + pool-wiring mismatch reverts
//   - seedPools missing-init / double-seed / not-owner reverts
//   - Pause-gates on transfers (world paused -> all gameplay writes blocked)
//
// All tests follow the existing harness pattern (subclass ClanWorld and
// expose storage setters where required).
// =============================================================================

import {Test} from "forge-std/Test.sol";
import {ClanWorld} from "../src/ClanWorld.sol";
import {MinimalERC20} from "../src/MinimalERC20.sol";
import {StubPool} from "../src/StubPool.sol";
import {
    ClanState,
    ClansmanState,
    ResourceType,
    PoolSeedConfig
} from "../src/IClanWorld.sol";

/// @dev Harness exposing internal storage and helpers we need for revert-path
///      coverage. Mirrors patterns from DirectTransfers.t.sol / BaseUpgrades.t.sol.
contract RevertPathHarness is ClanWorld {
    function killClan(uint32 clanId) external {
        _clans[clanId].clanState = ClanState.DEAD;
    }

    function killClansman(uint32 clansmanId) external {
        if (_clansmen[clansmanId].state != ClansmanState.DEAD) {
            _clansmen[clansmanId].state = ClansmanState.DEAD;
            uint32 clanId = _clansmen[clansmanId].clanId;
            if (_clans[clanId].livingClansmen > 0) {
                _clans[clanId].livingClansmen--;
            }
        }
    }

    function getClansmanState(uint32 clansmanId) external view returns (ClansmanState) {
        return _clansmen[clansmanId].state;
    }

    function getLivingClansmen(uint32 clanId) external view returns (uint8) {
        return _clans[clanId].livingClansmen;
    }
}

contract UntestedRevertPathsTest is Test {
    RevertPathHarness world;

    address owner = address(this); // deployer == treasuryOwner
    address stranger = address(0xBADBAD);
    address clanOwner = address(0xA1);
    address clanOwner2 = address(0xA2);

    uint32 clan1;
    uint32 clan2;

    function setUp() public {
        world = new RevertPathHarness();
        (clan1,) = world.mintClan(clanOwner);
        (clan2,) = world.mintClan(clanOwner2);
    }

    function _firstClansmanId(uint32 clanId) internal view returns (uint32) {
        return world.getClanFullView(clanId).clansmen[0].clansman.clansman.clansmanId;
    }

    // =========================================================================
    // pauseWorld / unpauseWorld — access control + state-machine
    // =========================================================================

    function test_pauseWorld_nonOwner_reverts() public {
        vm.prank(stranger);
        vm.expectRevert("ClanWorld: not owner");
        world.pauseWorld();
    }

    function test_pauseWorld_when_already_paused_reverts() public {
        world.pauseWorld();
        assertTrue(world.isWorldPaused(), "world paused after first call");
        vm.expectRevert("ClanWorld: already paused");
        world.pauseWorld();
    }

    function test_unpauseWorld_nonOwner_reverts() public {
        world.pauseWorld();
        vm.prank(stranger);
        vm.expectRevert("ClanWorld: not owner");
        world.unpauseWorld();
    }

    function test_unpauseWorld_when_not_paused_reverts() public {
        assertFalse(world.isWorldPaused(), "world starts unpaused");
        vm.expectRevert("ClanWorld: not paused");
        world.unpauseWorld();
    }

    function test_pause_unpause_full_round_trip() public {
        world.pauseWorld();
        assertTrue(world.isWorldPaused());
        world.unpauseWorld();
        assertFalse(world.isWorldPaused());
        // And we can pause again after unpause
        world.pauseWorld();
        assertTrue(world.isWorldPaused());
    }

    // =========================================================================
    // World-paused gate on gameplay writes — CHARACTERIZATION TESTS
    // =========================================================================
    // FINDING (Agent A, 2026-05-24): The monolithic ClanWorld transfer
    // functions (`transferGold`, `transferVaultResource`, `transferBlueprint`,
    // `transferBundle`) do NOT call `_requireWorldNotPaused`, while the
    // Diamond-facet equivalents (LibDirectTransfers / LibBundleTransfer) DO
    // gate via `LibGameRules.requireWorldNotPaused`. The asymmetry means OTC
    // transfers in the monolithic contract succeed during emergency pause.
    // These tests pin the *current* monolithic behavior (and would catch
    // either fix-direction regression). See research log for follow-up.

    function test_transferGold_while_world_paused_monolithic_does_NOT_block() public {
        world.pauseWorld();
        uint256 from0 = world.getClan(clan1).goldBalance;
        uint256 to0 = world.getClan(clan2).goldBalance;
        vm.prank(clanOwner);
        // Asserts the (arguably buggy) current behavior: transfer succeeds.
        world.transferGold(clan1, clan2, 1e18);
        assertEq(world.getClan(clan1).goldBalance, from0 - 1e18, "transfer went through even paused");
        assertEq(world.getClan(clan2).goldBalance, to0 + 1e18);
    }

    function test_transferBlueprint_while_world_paused_monolithic_does_NOT_block() public {
        // Same monolithic gap as gold — bypass test via existing-bp setup.
        // We can't seed bp from outside the contract; use a harness setter would
        // require a custom setter. For now pin the pause behavior at the
        // pre-deduct stage: paused world still permits entry into transferBlueprint.
        world.pauseWorld();
        vm.prank(clanOwner);
        // No blueprints to transfer, so we expect insufficient-blueprints, NOT
        // "world paused". That asymmetry is the real finding.
        vm.expectRevert("ClanWorld: insufficient blueprints");
        world.transferBlueprint(clan1, clan2, 1e18);
    }

    function test_transferVaultResource_while_world_paused_monolithic_does_NOT_block() public {
        world.pauseWorld();
        uint256 from0 = world.getClan(clan1).vaultWood;
        uint256 to0 = world.getClan(clan2).vaultWood;
        vm.prank(clanOwner);
        world.transferVaultResource(clan1, clan2, ResourceType.Wood, 1e18);
        assertEq(world.getClan(clan1).vaultWood, from0 - 1e18);
        assertEq(world.getClan(clan2).vaultWood, to0 + 1e18);
    }

    function test_transferBundle_while_world_paused_monolithic_does_NOT_block() public {
        world.pauseWorld();
        uint256 from0 = world.getClan(clan1).goldBalance;
        uint256 to0 = world.getClan(clan2).goldBalance;
        vm.prank(clanOwner);
        world.transferBundle(clan1, clan2, 1e18, 0, 0, 0, 0, 0);
        assertEq(world.getClan(clan1).goldBalance, from0 - 1e18);
        assertEq(world.getClan(clan2).goldBalance, to0 + 1e18);
    }

    function test_pauseFlag_persists_across_interactions() public {
        world.pauseWorld();
        assertTrue(world.isWorldPaused());
        // No-op view call shouldn't toggle pause.
        world.getClan(clan1);
        assertTrue(world.isWorldPaused(), "pause survives a view call");
    }

    // =========================================================================
    // reviveDeadClansmen — owner gate
    // =========================================================================

    function test_reviveDeadClansmen_nonOwner_reverts() public {
        vm.prank(stranger);
        vm.expectRevert("ClanWorld: not owner");
        world.reviveDeadClansmen(clan1);
    }

    function test_reviveDeadClansmen_unknown_clan_is_noop() public {
        // No clansmen registered under clan id 9999 → loop body never runs,
        // no revert. The function silently no-ops; this pins the silent-noop
        // contract so any future stricter behavior would fail the test.
        world.reviveDeadClansmen(9999);
    }

    function test_reviveDeadClansmen_brings_back_dead_clansman() public {
        uint32 csId = _firstClansmanId(clan1);
        world.killClansman(csId);
        assertEq(uint8(world.getClansmanState(csId)), uint8(ClansmanState.DEAD), "killed");

        world.reviveDeadClansmen(clan1);

        assertEq(
            uint8(world.getClansmanState(csId)),
            uint8(ClansmanState.WAITING),
            "revived to WAITING"
        );
    }

    // =========================================================================
    // reviveClansman — owner gate + custom-error not-found
    // =========================================================================

    function test_reviveClansman_nonOwner_reverts() public {
        vm.prank(stranger);
        vm.expectRevert("ClanWorld: not owner");
        world.reviveClansman(1);
    }

    function test_reviveClansman_unknown_id_reverts_with_custom_error() public {
        // _reviveClansman is called with revertOnNotFound=true from the
        // single-target path. An unknown clansmanId triggers
        // AdminRecoveryClansmanNotFound(unknownId).
        uint32 unknownId = 999_999;
        bytes4 selector = bytes4(keccak256("AdminRecoveryClansmanNotFound(uint32)"));
        vm.expectRevert(abi.encodeWithSelector(selector, unknownId));
        world.reviveClansman(unknownId);
    }

    function test_reviveClansman_zero_id_reverts_with_custom_error() public {
        bytes4 selector = bytes4(keccak256("AdminRecoveryClansmanNotFound(uint32)"));
        vm.expectRevert(abi.encodeWithSelector(selector, uint32(0)));
        world.reviveClansman(0);
    }

    function test_reviveClansman_already_alive_is_noop() public {
        uint32 csId = _firstClansmanId(clan1);
        // Not dead — call must return cleanly without revert and without
        // touching state.
        ClansmanState before = world.getClansmanState(csId);
        world.reviveClansman(csId);
        assertEq(
            uint8(world.getClansmanState(csId)),
            uint8(before),
            "state unchanged on already-alive revive"
        );
    }

    // =========================================================================
    // injectClanResources — owner gate + clan-not-found custom error
    // =========================================================================

    function test_injectClanResources_nonOwner_reverts() public {
        vm.prank(stranger);
        vm.expectRevert("ClanWorld: not owner");
        world.injectClanResources(clan1, 1e18, 1e18, 1e18, 1e18, 1e18, 1e18);
    }

    function test_injectClanResources_unknown_clan_reverts_with_custom_error() public {
        uint32 unknownClanId = 7777;
        bytes4 selector = bytes4(keccak256("AdminRecoveryClanNotFound(uint32)"));
        vm.expectRevert(abi.encodeWithSelector(selector, unknownClanId));
        world.injectClanResources(unknownClanId, 1e18, 0, 0, 0, 0, 0);
    }

    function test_injectClanResources_happy_path_adds_to_vault() public {
        uint256 woodBefore = world.getClan(clan1).vaultWood;
        uint256 goldBefore = world.getClan(clan1).goldBalance;
        uint256 bpBefore = world.getClan(clan1).blueprintBalance;

        world.injectClanResources(clan1, 100e18, 50e18, 25e18, 10e18, 5e18, 3e18);

        assertEq(world.getClan(clan1).vaultWood, woodBefore + 100e18, "wood added");
        assertEq(world.getClan(clan1).vaultIron, 50e18, "iron set");
        assertEq(world.getClan(clan1).vaultWheat, 25e18 + 20e18, "wheat added");
        assertEq(world.getClan(clan1).vaultFish, 10e18 + 2e18, "fish added");
        assertEq(world.getClan(clan1).goldBalance, goldBefore + 5e18, "gold added");
        assertEq(world.getClan(clan1).blueprintBalance, bpBefore + 3e18, "bp added");
    }

    function test_injectClanResources_zero_amounts_succeeds_and_no_op() public {
        // All zeros is a valid call (it emits ResourcesInjected with 0s) —
        // confirm it doesn't revert. This is a quirky contract behavior pin.
        uint256 woodBefore = world.getClan(clan1).vaultWood;
        world.injectClanResources(clan1, 0, 0, 0, 0, 0, 0);
        assertEq(world.getClan(clan1).vaultWood, woodBefore, "no change");
    }

    // =========================================================================
    // initTreasury — double-init + pool wiring mismatch reverts
    // =========================================================================

    function _validInit(ClanWorld w)
        internal
        returns (
            address[6] memory tokens,
            address[4] memory pools,
            MinimalERC20[6] memory tokenContracts
        )
    {
        MinimalERC20 wood = new MinimalERC20("Wood", "WOOD");
        MinimalERC20 iron = new MinimalERC20("Iron", "IRON");
        MinimalERC20 wheat = new MinimalERC20("Wheat", "WHEAT");
        MinimalERC20 fish = new MinimalERC20("Fish", "FISH");
        MinimalERC20 gold = new MinimalERC20("Gold", "GOLD");
        MinimalERC20 bp = new MinimalERC20("BP", "BP");
        tokens = [
            address(wood),
            address(iron),
            address(wheat),
            address(fish),
            address(gold),
            address(bp)
        ];
        pools = [
            address(new StubPool(address(wood), address(gold), address(w))),
            address(new StubPool(address(wheat), address(gold), address(w))),
            address(new StubPool(address(fish), address(gold), address(w))),
            address(new StubPool(address(iron), address(gold), address(w)))
        ];
        tokenContracts = [wood, iron, wheat, fish, gold, bp];
    }

    function test_initTreasury_double_init_reverts() public {
        ClanWorld w = new ClanWorld();
        (address[6] memory tokens, address[4] memory pools, ) = _validInit(w);
        w.initTreasury(tokens, pools);
        // Second call — even with different addresses — must hit the
        // "treasury already init" guard before the validation block.
        (address[6] memory tokens2, address[4] memory pools2, ) = _validInit(w);
        vm.expectRevert("ClanWorld: treasury already init");
        w.initTreasury(tokens2, pools2);
    }

    function test_initTreasury_nonOwner_reverts() public {
        ClanWorld w = new ClanWorld();
        (address[6] memory tokens, address[4] memory pools, ) = _validInit(w);
        vm.prank(stranger);
        vm.expectRevert("ClanWorld: not owner");
        w.initTreasury(tokens, pools);
    }

    function test_initTreasury_token_not_contract_reverts() public {
        ClanWorld w = new ClanWorld();
        (address[6] memory tokens, address[4] memory pools, ) = _validInit(w);
        // EOA-style address (no code) for wood slot
        tokens[0] = address(0xC0FFEE);
        vm.expectRevert("ClanWorld: treasury token not contract");
        w.initTreasury(tokens, pools);
    }

    function test_initTreasury_pool_not_contract_reverts() public {
        ClanWorld w = new ClanWorld();
        (address[6] memory tokens, address[4] memory pools, ) = _validInit(w);
        pools[0] = address(0xBEEF);
        vm.expectRevert("ClanWorld: treasury pool not contract");
        w.initTreasury(tokens, pools);
    }

    function test_initTreasury_pool_wiring_tokenA_mismatch_reverts() public {
        ClanWorld w = new ClanWorld();
        (address[6] memory tokens, address[4] memory pools, ) = _validInit(w);
        // Swap pool[0] (expected wood/gold) for a pool that has wheat/gold.
        // Validator should reject because TOKEN_A doesn't equal tokens[0].
        pools[0] = pools[1];
        // But that also creates a duplicate-pool collision which fires first.
        // To isolate the wiring revert, construct a fresh pool with wrong tokenA.
        MinimalERC20 bogus = new MinimalERC20("Bogus", "BOG");
        pools[0] = address(new StubPool(address(bogus), tokens[4], address(w)));
        vm.expectRevert("ClanWorld: treasury pool token A mismatch");
        w.initTreasury(tokens, pools);
    }

    function test_initTreasury_pool_wiring_tokenB_mismatch_reverts() public {
        ClanWorld w = new ClanWorld();
        (address[6] memory tokens, address[4] memory pools, ) = _validInit(w);
        MinimalERC20 bogusGold = new MinimalERC20("BogusGold", "BG");
        // tokenA is correct (tokens[0] = wood), tokenB is wrong (not the gold token)
        pools[0] = address(new StubPool(tokens[0], address(bogusGold), address(w)));
        vm.expectRevert("ClanWorld: treasury pool token B mismatch");
        w.initTreasury(tokens, pools);
    }

    function test_initTreasury_pool_wiring_engine_mismatch_reverts() public {
        ClanWorld w = new ClanWorld();
        (address[6] memory tokens, address[4] memory pools, ) = _validInit(w);
        // tokenA + tokenB correct, but engine pointer is some other address
        address bogusEngine = address(0xDEAD);
        pools[0] = address(new StubPool(tokens[0], tokens[4], bogusEngine));
        vm.expectRevert("ClanWorld: treasury pool engine mismatch");
        w.initTreasury(tokens, pools);
    }

    // =========================================================================
    // seedPools — missing-init / double-seed / not-owner
    // =========================================================================

    function test_seedPools_nonOwner_reverts() public {
        // setUp's `world` has never been initTreasury'd → so first revert
        // for non-owner would be the owner check. Confirm that gate fires
        // even without a valid init.
        PoolSeedConfig memory cfg = PoolSeedConfig({
            woodSeed: 1,
            wheatSeed: 1,
            fishSeed: 1,
            ironSeed: 1,
            goldSeedForWood: 1,
            goldSeedForWheat: 1,
            goldSeedForFish: 1,
            goldSeedForIron: 1
        });
        vm.prank(stranger);
        vm.expectRevert("ClanWorld: not owner");
        world.seedPools(cfg);
    }

    function test_seedPools_before_initTreasury_reverts() public {
        // The setUp world has never had initTreasury called.
        // Owner calls seedPools → must hit "treasury not init".
        PoolSeedConfig memory cfg = PoolSeedConfig({
            woodSeed: 1,
            wheatSeed: 1,
            fishSeed: 1,
            ironSeed: 1,
            goldSeedForWood: 1,
            goldSeedForWheat: 1,
            goldSeedForFish: 1,
            goldSeedForIron: 1
        });
        vm.expectRevert("ClanWorld: treasury not init");
        world.seedPools(cfg);
    }

    function test_seedPools_double_seed_reverts() public {
        // Full setup → seed → second seed must revert with "pools already seeded".
        ClanWorld w = new ClanWorld();
        (
            address[6] memory tokens,
            address[4] memory pools,
            MinimalERC20[6] memory tokenContracts
        ) = _validInit(w);
        w.initTreasury(tokens, pools);

        uint256 woodSeed = w.INITIAL_WOOD_POOL_SEED();
        uint256 wheatSeed = w.INITIAL_WHEAT_POOL_SEED();
        uint256 fishSeed = w.INITIAL_FISH_POOL_SEED();
        uint256 ironSeed = w.INITIAL_IRON_POOL_SEED();
        uint256 gW = w.INITIAL_GOLD_SEED_FOR_WOOD();
        uint256 gH = w.INITIAL_GOLD_SEED_FOR_WHEAT();
        uint256 gF = w.INITIAL_GOLD_SEED_FOR_FISH();
        uint256 gI = w.INITIAL_GOLD_SEED_FOR_IRON();
        uint256 totalGold = gW + gH + gF + gI;

        tokenContracts[0].seedTreasury(address(this), woodSeed);
        tokenContracts[1].seedTreasury(address(this), ironSeed);
        tokenContracts[2].seedTreasury(address(this), wheatSeed);
        tokenContracts[3].seedTreasury(address(this), fishSeed);
        tokenContracts[4].seedTreasury(address(this), totalGold);

        tokenContracts[0].approve(address(w), woodSeed);
        tokenContracts[1].approve(address(w), ironSeed);
        tokenContracts[2].approve(address(w), wheatSeed);
        tokenContracts[3].approve(address(w), fishSeed);
        tokenContracts[4].approve(address(w), totalGold);

        PoolSeedConfig memory cfg = PoolSeedConfig({
            woodSeed: woodSeed,
            wheatSeed: wheatSeed,
            fishSeed: fishSeed,
            ironSeed: ironSeed,
            goldSeedForWood: gW,
            goldSeedForWheat: gH,
            goldSeedForFish: gF,
            goldSeedForIron: gI
        });
        w.seedPools(cfg);

        vm.expectRevert("ClanWorld: pools already seeded");
        w.seedPools(cfg);
    }

    // =========================================================================
    // finalizeSeason — season-not-ended + double-finalize guards
    // =========================================================================

    function test_finalizeSeason_before_season_end_reverts() public {
        // At setUp, currentTick=0 and seasonEndTick=SEASON_DURATION_TICKS,
        // so the "season not ended" guard must fire.
        vm.expectRevert("ClanWorld: season not ended");
        world.finalizeSeason();
    }
}
