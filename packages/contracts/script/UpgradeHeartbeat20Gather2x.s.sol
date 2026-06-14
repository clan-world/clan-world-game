// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Script, console} from "forge-std/Script.sol";
import {DiamondSelectors} from "./DiamondSelectors.sol";
import {IDiamondCut} from "../src/diamond/IDiamondCut.sol";
import {HeartbeatFacet} from "../src/diamond/facets/HeartbeatFacet.sol";
import {HeartbeatConfigFacet} from "../src/diamond/facets/HeartbeatConfigFacet.sol";
import {WorldPauseFacet} from "../src/diamond/facets/WorldPauseFacet.sol";
import {SettlementFacet} from "../src/diamond/facets/SettlementFacet.sol";
import {DerivedViewsFacet} from "../src/diamond/facets/DerivedViewsFacet.sol";
import {ScoringViewsFacet} from "../src/diamond/facets/ScoringViewsFacet.sol";
import {FinalizeSeasonFacet} from "../src/diamond/facets/FinalizeSeasonFacet.sol";

/// @notice HACKATHON upgrade: HEARTBEAT_INTERVAL_SECONDS 60->20 + all
///         gather yields doubled (WOOD/IRON/WHEAT/FISH). The constants are
///         inlined (Solidity `internal constant`) into every facet whose
///         bytecode references them, so all such facets must be redeployed +
///         diamondCut-REPLACEd. The diamond storage layout is untouched, so
///         all live game state (seasons, clans, ticks) survives the cut.
///
/// Affected facets (constant inlining traced 2026-06-13):
///   - HeartbeatFacet      — LibHeartbeat -> LibWorldClock (heartbeat schedule)
///                           + LibSettlement (gather yields settled in tick)
///   - HeartbeatConfigFacet— LibWorldClock (heartbeatIntervalSeconds() default)
///   - WorldPauseFacet     — LibWorldClock (reschedule on unpause)
///   - SettlementFacet     — LibSettlement (gather yields)
///   - DerivedViewsFacet   — LibSettlement (gather yields, view sim)
///   - ScoringViewsFacet   — LibSettlement (gather yields, view sim)
///   - FinalizeSeasonFacet — LibSettlement (gather yields)
///
/// @dev On the local anvil fork the owner is unlocked. Run with:
///   forge script script/UpgradeHeartbeat20Gather2x.s.sol \
///     --rpc-url http://127.0.0.1:8545 --broadcast --unlocked \
///     --sender 0x02C4d76d0Ce17c6a81cD44C810167D79d99267c7
///
/// Required env:
///   - CLAN_WORLD_DIAMOND_ADDRESS (preferred) or CLAN_WORLD_CONTRACT_ADDRESS
contract UpgradeHeartbeat20Gather2x is Script {
    function run() external {
        address diamond = _diamondAddress();

        vm.startBroadcast();

        HeartbeatFacet heartbeatFacet = new HeartbeatFacet();
        HeartbeatConfigFacet heartbeatConfigFacet = new HeartbeatConfigFacet();
        WorldPauseFacet worldPauseFacet = new WorldPauseFacet();
        SettlementFacet settlementFacet = new SettlementFacet();
        DerivedViewsFacet derivedViewsFacet = new DerivedViewsFacet();
        ScoringViewsFacet scoringViewsFacet = new ScoringViewsFacet();
        FinalizeSeasonFacet finalizeSeasonFacet = new FinalizeSeasonFacet();

        IDiamondCut.FacetCut[] memory cut = new IDiamondCut.FacetCut[](7);
        cut[0] = IDiamondCut.FacetCut({
            facetAddress: address(heartbeatFacet),
            action: IDiamondCut.FacetCutAction.Replace,
            functionSelectors: DiamondSelectors.heartbeatSelectors()
        });
        cut[1] = IDiamondCut.FacetCut({
            facetAddress: address(heartbeatConfigFacet),
            action: IDiamondCut.FacetCutAction.Replace,
            functionSelectors: DiamondSelectors.heartbeatConfigSelectors()
        });
        cut[2] = IDiamondCut.FacetCut({
            facetAddress: address(worldPauseFacet),
            action: IDiamondCut.FacetCutAction.Replace,
            functionSelectors: DiamondSelectors.worldPauseSelectors()
        });
        cut[3] = IDiamondCut.FacetCut({
            facetAddress: address(settlementFacet),
            action: IDiamondCut.FacetCutAction.Replace,
            functionSelectors: DiamondSelectors.settlementSelectors()
        });
        cut[4] = IDiamondCut.FacetCut({
            facetAddress: address(derivedViewsFacet),
            action: IDiamondCut.FacetCutAction.Replace,
            functionSelectors: DiamondSelectors.derivedViewsSelectors()
        });
        cut[5] = IDiamondCut.FacetCut({
            facetAddress: address(scoringViewsFacet),
            action: IDiamondCut.FacetCutAction.Replace,
            functionSelectors: DiamondSelectors.scoringViewsSelectors()
        });
        cut[6] = IDiamondCut.FacetCut({
            facetAddress: address(finalizeSeasonFacet),
            action: IDiamondCut.FacetCutAction.Replace,
            functionSelectors: DiamondSelectors.seasonSelectors()
        });

        IDiamondCut(diamond).diamondCut(cut, address(0), "");

        vm.stopBroadcast();

        console.log("DIAMOND:                  ", diamond);
        console.log("HEARTBEAT_FACET:          ", address(heartbeatFacet));
        console.log("HEARTBEAT_CONFIG_FACET:   ", address(heartbeatConfigFacet));
        console.log("WORLD_PAUSE_FACET:        ", address(worldPauseFacet));
        console.log("SETTLEMENT_FACET:         ", address(settlementFacet));
        console.log("DERIVED_VIEWS_FACET:      ", address(derivedViewsFacet));
        console.log("SCORING_VIEWS_FACET:      ", address(scoringViewsFacet));
        console.log("FINALIZE_SEASON_FACET:    ", address(finalizeSeasonFacet));
    }

    function _diamondAddress() private view returns (address) {
        try vm.envAddress("CLAN_WORLD_DIAMOND_ADDRESS") returns (address d) {
            return d;
        } catch {
            return vm.envAddress("CLAN_WORLD_CONTRACT_ADDRESS");
        }
    }
}
