// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Test} from "forge-std/Test.sol";
import {ClanWorld} from "../src/ClanWorld.sol";
import {ClanAgentNFT} from "../src/ClanAgentNFT.sol";
import {Mock7857Verifier} from "../src/Mock7857Verifier.sol";
import {ClanOrder, ActionType, WithdrawResourcesData} from "../src/IClanWorld.sol";

/// @dev Harness exposes minimal state setters so we can simulate same-block
/// adversarial sequences without recreating the full lazy-settlement game loop.
contract CallOrderRacesHarness is ClanWorld {
    function setGoldBalance(uint32 clanId, uint256 amount) external {
        _clans[clanId].goldBalance = amount;
    }

    function setVaultFish(uint32 clanId, uint256 amount) external {
        _clans[clanId].vaultFish = amount;
    }

    function forceSeasonEnded() external {
        _world.currentTick = _world.seasonEndTick;
    }
}

/// @title CallOrderRacesTest
/// @notice Race / front-running / call-order / re-init tests across the
///         primary state-mutating entry points. Each test exercises a sequence
///         where two transactions in close temporal proximity must produce a
///         deterministic outcome (or revert deterministically).
contract CallOrderRacesTest is Test {
    CallOrderRacesHarness world;
    Mock7857Verifier verifier;
    ClanAgentNFT nft;

    address ownerA = address(0xA1);
    address ownerB = address(0xB2);
    address ownerC = address(0xC3);
    address attacker = address(0xDEAD);

    function setUp() public {
        world = new CallOrderRacesHarness();
        verifier = new Mock7857Verifier();
        nft = new ClanAgentNFT("ClanWorld Elder iNFT", "ELDER", address(verifier));
    }

    // ---------------------------------------------------------------------
    // Same-block double mint — clan IDs must be sequential, no collisions.
    // ---------------------------------------------------------------------
    function test_sameBlockDoubleMintClan_idsAreMonotonic() public {
        vm.prank(ownerA);
        (uint32 firstId, uint256 firstToken) = world.mintClan(ownerA);

        vm.prank(ownerB);
        (uint32 secondId, uint256 secondToken) = world.mintClan(ownerB);

        // Two adjacent mints in the same block (or any tx ordering) must
        // produce strictly monotonic clan IDs — proves the nextClanId
        // counter is post-incremented and not vulnerable to reorder-collision.
        assertEq(secondId, firstId + 1, "clan ids must be monotonic across rapid mints");
        assertEq(uint256(firstId), firstToken, "iftTokenId mirrors clanId for first mint");
        assertEq(uint256(secondId), secondToken, "iftTokenId mirrors clanId for second mint");
        assertEq(world.getClan(firstId).owner, ownerA, "first mint owner persists after second mint");
        assertEq(world.getClan(secondId).owner, ownerB, "second mint owner persists");
    }

    // ---------------------------------------------------------------------
    // Owner-transfer front-run: previous owner cannot call privileged
    // entry points (transferGold / submitClanOrders / transferOwnership again)
    // in the same block after ownership has moved.
    // ---------------------------------------------------------------------
    function test_ownershipTransfer_oldOwnerLosesAllAuthorityInSameBlock() public {
        vm.prank(ownerA);
        (uint32 clanId,) = world.mintClan(ownerA);
        vm.prank(ownerB);
        (uint32 otherClanId,) = world.mintClan(ownerB);

        world.setGoldBalance(clanId, 100e18);

        // Block N: ownerA hands clan to attacker (e.g. via OTC sale signed off-chain).
        vm.prank(ownerA);
        world.transferClanOwnership(clanId, attacker);

        // Same block, next tx: ownerA tries to drain gold using the now-stale auth.
        vm.prank(ownerA);
        vm.expectRevert(bytes("ClanWorld: not clan owner"));
        world.transferGold(clanId, otherClanId, 50e18);

        // Same block: ownerA tries to submit orders. submitClanOrders reverts
        // (not returns per-order status) when the caller isn't the clan owner.
        ClanOrder[] memory orders = new ClanOrder[](1);
        orders[0] = ClanOrder({
            clansmanId: _firstCs(clanId),
            gotoRegion: world.getClan(clanId).baseRegion,
            action: ActionType.Wait,
            targetClanId: 0,
            marketToken: address(0),
            marketAmount: 0,
            maxGoldIn: 0,
            withdrawResources: WithdrawResourcesData({wood: 0, iron: 0, wheat: 0, fish: 0})
        });
        vm.prank(ownerA);
        vm.expectRevert(bytes("ClanWorld: not clan owner"));
        world.submitClanOrders(clanId, orders);

        // And ownerA cannot re-transfer to themselves.
        vm.prank(ownerA);
        vm.expectRevert(bytes("ClanWorld: not clan owner"));
        world.transferClanOwnership(clanId, ownerA);
    }

    // ---------------------------------------------------------------------
    // Double transferGold in same block — read-then-write consistency:
    // the second call MUST observe the post-first balance, never the
    // pre-first stale balance (no double-spend MEV).
    // ---------------------------------------------------------------------
    function test_doubleTransferGold_sameBlock_secondSeesPostFirstBalance() public {
        vm.prank(ownerA);
        (uint32 fromClan,) = world.mintClan(ownerA);
        vm.prank(ownerB);
        (uint32 toClan,) = world.mintClan(ownerB);

        world.setGoldBalance(fromClan, 10e18);

        // Tx 1 in block N
        vm.prank(ownerA);
        world.transferGold(fromClan, toClan, 7e18);
        assertEq(world.getClan(fromClan).goldBalance, 3e18, "after first tx balance reduced");

        // Tx 2 in block N — attempting to re-spend the original 10e18 must revert
        // because the contract reads the latest balance (3e18), not a cached snapshot.
        vm.prank(ownerA);
        vm.expectRevert(bytes("ClanWorld: insufficient gold"));
        world.transferGold(fromClan, toClan, 7e18);

        // A spend within the new available range still works in the same block.
        vm.prank(ownerA);
        world.transferGold(fromClan, toClan, 3e18);
        assertEq(world.getClan(fromClan).goldBalance, 0, "fully drained after two valid sends");
        assertEq(world.getClan(toClan).goldBalance, 13e18, "recipient gets full 7+3");
    }

    // ---------------------------------------------------------------------
    // finalizeSeason check-then-act race: two callers attempt to finalize
    // back-to-back. The second one MUST revert with "season finalized".
    // ---------------------------------------------------------------------
    function test_finalizeSeason_doubleCallSameBlock_secondReverts() public {
        // Mint at least one clan so the loop has work to do.
        vm.prank(ownerA);
        world.mintClan(ownerA);

        // Push the world clock to the season end so finalizeSeason is eligible.
        world.forceSeasonEnded();

        // Tx 1: caller X finalises.
        world.finalizeSeason();

        // Tx 2 same block from a different (front-running) caller — MUST revert.
        vm.prank(attacker);
        vm.expectRevert(bytes("ClanWorld: season finalized"));
        world.finalizeSeason();
    }

    // ---------------------------------------------------------------------
    // initTreasury one-shot guard: even if the first init reverts deep inside
    // (e.g. bad pool wiring), the second init must still work. But once a
    // successful init lands, replays must be blocked even by the original
    // treasury owner. Here we cover the success-then-replay branch.
    // ---------------------------------------------------------------------
    function test_initTreasury_replayBlockedAfterSuccess() public {
        // Use the ClanWorld constructor-set treasury owner (= this contract).
        // We rely on the existing Reentrancy harness pattern: spin up a
        // minimal treasury init via the production ClanWorld setupTreasury
        // helpers. The treasury owner is `address(this)` because we deployed
        // CallOrderRacesHarness from this test contract.
        // We use a smoke approach: any second init call must revert with the
        // canonical "treasury already init" string, regardless of the params,
        // because the guard checks BEFORE param validation runs.
        // (We trigger one successful init via the canonical mock pool setup.)

        (address[6] memory tokens, address[4] memory pools) = _setupCanonicalTreasury();
        world.initTreasury(tokens, pools);

        // Replay: even with the IDENTICAL params, the guard must trip first.
        vm.expectRevert(bytes("ClanWorld: treasury already init"));
        world.initTreasury(tokens, pools);

        // And from a different caller (attacker trying to overwrite treasury wiring).
        vm.prank(attacker);
        vm.expectRevert(bytes("ClanWorld: treasury already init"));
        world.initTreasury(tokens, pools);
    }

    // ---------------------------------------------------------------------
    // Re-init via different caller: pre-init, a NON-owner attempting init
    // must be rejected by the owner-gate, leaving the slot still re-usable
    // by the true owner. This protects against front-running an init by an
    // attacker who wants to wire malicious pools before the legitimate
    // deployer can run their bootstrap script.
    // ---------------------------------------------------------------------
    function test_initTreasury_nonOwnerFrontrunBlocked_realOwnerCanStillInit() public {
        (address[6] memory tokens, address[4] memory pools) = _setupCanonicalTreasury();

        // Attacker front-runs the deployer's init tx with their own.
        vm.prank(attacker);
        vm.expectRevert(bytes("ClanWorld: not owner"));
        world.initTreasury(tokens, pools);

        // Owner (this contract) still completes init successfully — guard
        // never flipped because attacker's call was rejected before state writes.
        world.initTreasury(tokens, pools);

        // Sanity: subsequent re-init is now properly blocked.
        vm.expectRevert(bytes("ClanWorld: treasury already init"));
        world.initTreasury(tokens, pools);
    }

    // ---------------------------------------------------------------------
    // NFT setApprovalForAll then transferFrom does NOT clear operator approval.
    // This is a known ERC-721 design choice but we lock it in to document the
    // post-sale risk: a buyer who doesn't revoke the seller's operator approval
    // can be back-run by the seller via setApprovalForAll left intact.
    // (We assert behavior, not whether it's a bug — but we attach a comment.)
    // ---------------------------------------------------------------------
    function test_nftSetApprovalForAll_persistsAcrossTransfer_documentsHazard() public {
        nft.mint(ownerA, 11, _data("persona", "alice"));

        // Owner A grants operator full approval (e.g. marketplace).
        vm.prank(ownerA);
        nft.setApprovalForAll(attacker, true);
        assertTrue(nft.isApprovedForAll(ownerA, attacker), "operator approval set");

        // Owner transfers token to buyer (ownerB).
        vm.prank(ownerA);
        nft.transferFrom(ownerA, ownerB, 11);
        assertEq(nft.ownerOf(11), ownerB, "token now owned by buyer");

        // Seller's operator approval for THEIR address still stands, but it
        // does not give the operator authority over the new owner's tokens —
        // approval is per-owner, not per-token. Confirm that.
        assertFalse(
            nft.isApprovedForAll(ownerB, attacker),
            "operator approval does NOT carry over to buyer"
        );

        // Critically: per-token approval IS cleared by _transfer.
        assertEq(nft.getApproved(11), address(0), "per-token approval cleared on transfer");
    }

    // ---------------------------------------------------------------------
    // NFT post-transfer authorization hazard:
    // `usageAuthorizations[tokenId][user]` is NOT cleared on transfer, so
    // a previously-authorized user can still call `updateMetadata` after
    // ownership has moved. This is a real front-run / back-run hazard worth
    // flagging.
    //
    // We assert the CURRENT (buggy) behavior and tag this test with
    // BUG_FLAG so a future fix can flip the assertion.
    // ---------------------------------------------------------------------
    function test_nftPostTransfer_priorAuthorizedUserCanStillUpdateMetadata_BUG_FLAG() public {
        nft.mint(ownerA, 22, _data("persona", "alice"));

        // OwnerA pre-authorizes a delegate (e.g. an indexer or co-pilot).
        vm.prank(ownerA);
        nft.authorizeUsage(22, attacker);
        assertTrue(nft.usageAuthorizations(22, attacker), "delegate authorized pre-sale");

        // OwnerA sells/transfers token to ownerB. transferFrom does NOT
        // touch usageAuthorizations.
        vm.prank(ownerA);
        nft.transferFrom(ownerA, ownerB, 22);
        assertEq(nft.ownerOf(22), ownerB, "buyer now owns token");

        // The stale delegate can STILL update the new owner's metadata.
        // This is the hazard: a buyer must remember to revoke every prior
        // authorization or they inherit corruptible metadata.
        vm.prank(attacker);
        nft.updateMetadata(22, _data("persona", "attacker-overwrote"), "metadata-proof");

        ClanAgentNFT.IntelligentData[] memory after_ = nft.intelligentDataOf(22);
        assertEq(after_[0].uri, "attacker-overwrote", "stale delegate overwrote metadata");

        // ---- If the contract is fixed to clear usageAuthorizations on
        // transfer, flip the assertion above to expect a revert with
        // ClanAgentNFT.NotApprovedOrOwner.selector and remove the BUG_FLAG tag.
    }

    // ---------------------------------------------------------------------
    // NFT iTransfer + same-block updateMetadata by NEW owner: ordering must
    // be consistent — the new owner can update metadata immediately after
    // iTransfer (no cooldown / no stale check breaks).
    // ---------------------------------------------------------------------
    function test_nftITransfer_thenSameBlockUpdateMetadataByNewOwner_succeeds() public {
        nft.mint(ownerA, 33, _data("persona", "alice"));

        vm.prank(ownerA);
        nft.iTransfer(
            ownerB,
            33,
            _data("persona", "bob-fresh"),
            ClanAgentNFT.TransferProof({
                newDataHash: bytes32(0),
                encryptedKeyHash: keccak256("dek-bob"),
                newUri: "bob-fresh",
                proof: "demo-proof"
            })
        );
        assertEq(nft.ownerOf(33), ownerB, "iTransfer moved ownership");

        // Same block: new owner overwrites metadata again. Must succeed.
        vm.prank(ownerB);
        nft.updateMetadata(33, _data("persona", "bob-edit-2"), "metadata-proof");

        ClanAgentNFT.IntelligentData[] memory data = nft.intelligentDataOf(33);
        assertEq(data[0].uri, "bob-edit-2", "new owner can update immediately");
    }

    // =========================================================================
    // helpers
    // =========================================================================

    function _firstCs(uint32 clanId) internal view returns (uint32) {
        return world.getClanFullView(clanId).clansmen[0].clansman.clansman.clansmanId;
    }

    function _setupCanonicalTreasury() internal returns (address[6] memory tokens, address[4] memory pools) {
        // Deploy 6 fresh tokens and 4 stub pools wired in the canonical
        // order required by TreasuryFacet._requirePoolWiring:
        //   pools[0] = woodGold (woodToken, goldToken)
        //   pools[1] = wheatGold (wheatToken, goldToken)
        //   pools[2] = fishGold (fishToken, goldToken)
        //   pools[3] = ironGold (ironToken, goldToken)
        // Tokens array order:
        //   [0]=wood, [1]=iron, [2]=wheat, [3]=fish, [4]=gold, [5]=blueprint
        address wood = address(new MinTok("Wood", "WOOD"));
        address iron = address(new MinTok("Iron", "IRON"));
        address wheat = address(new MinTok("Wheat", "WHT"));
        address fish = address(new MinTok("Fish", "FISH"));
        address gold = address(new MinTok("Gold", "GOLD"));
        address bprt = address(new MinTok("Blueprint", "BPRT"));

        address woodGoldPool = address(new MinPool(wood, gold, address(world)));
        address wheatGoldPool = address(new MinPool(wheat, gold, address(world)));
        address fishGoldPool = address(new MinPool(fish, gold, address(world)));
        address ironGoldPool = address(new MinPool(iron, gold, address(world)));

        tokens[0] = wood;
        tokens[1] = iron;
        tokens[2] = wheat;
        tokens[3] = fish;
        tokens[4] = gold;
        tokens[5] = bprt;

        pools[0] = woodGoldPool;
        pools[1] = wheatGoldPool;
        pools[2] = fishGoldPool;
        pools[3] = ironGoldPool;
    }

    function _data(string memory label, string memory uri)
        internal
        pure
        returns (ClanAgentNFT.IntelligentData[] memory data)
    {
        data = new ClanAgentNFT.IntelligentData[](1);
        data[0] = ClanAgentNFT.IntelligentData({
            label: label,
            dataHash: keccak256(bytes(uri)),
            uri: uri
        });
    }
}

// =========================================================================
// minimal local stub tokens / pools (avoid pulling MinimalERC20 + StubPool
// transitive setup just for the init guard test)
// =========================================================================

contract MinTok {
    string public name;
    string public symbol;

    constructor(string memory n, string memory s) {
        name = n;
        symbol = s;
    }
}

contract MinPool {
    address public immutable TOKEN_A;
    address public immutable TOKEN_B;
    address public immutable ENGINE;

    constructor(address a, address b, address eng) {
        TOKEN_A = a;
        TOKEN_B = b;
        ENGINE = eng;
    }
}
