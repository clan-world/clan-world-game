/// ClanWorld logo NFT — a free public mint (caller pays only gas).
/// Image is served from Walrus (decentralized storage), referenced by the
/// Display standard so wallets/explorers/SuiNS render it.
module clan_logo_nft::clan_logo_nft;

use std::string::{Self, String};
use sui::display;
use sui::package;
use sui::url::{Self, Url};

/// Walrus aggregator URL for the ClanWorld crest logo blob.
const IMAGE_URL: vector<u8> =
    b"https://aggregator.walrus-mainnet.walrus.space/v1/blobs/9uCKVZktCJPMjm6vyZS1ayPSTh9B5yLU5dSs-2AFLdw";

/// One-Time Witness — must match the module name in ALL CAPS, have only `drop`.
public struct CLAN_LOGO_NFT has drop {}

/// The NFT object. `key` = on-chain object; `store` = transferable/storable.
public struct ClanLogoNFT has key, store {
    id: UID,
    name: String,
    description: String,
    image_url: Url,
    project_url: String,
}

/// Runs once at publish. Claims Publisher, wires up Display<ClanLogoNFT>,
/// then hands both to the publisher address.
fun init(otw: CLAN_LOGO_NFT, ctx: &mut TxContext) {
    let publisher = package::claim(otw, ctx);

    let keys = vector[
        string::utf8(b"name"),
        string::utf8(b"description"),
        string::utf8(b"image_url"),
        string::utf8(b"project_url"),
    ];
    // {field} templating resolves against each object's fields at render time.
    let values = vector[
        string::utf8(b"{name}"),
        string::utf8(b"{description}"),
        string::utf8(b"{image_url}"),
        string::utf8(b"{project_url}"),
    ];

    let mut disp = display::new_with_fields<ClanLogoNFT>(&publisher, keys, values, ctx);
    display::update_version(&mut disp);

    transfer::public_transfer(disp, ctx.sender());
    transfer::public_transfer(publisher, ctx.sender());
}

/// Free public mint — anyone can call; the NFT goes to the caller.
public fun mint(ctx: &mut TxContext) {
    let nft = ClanLogoNFT {
        id: object::new(ctx),
        name: string::utf8(b"Clan World: \xc3\x86lder Whispers"),
        description: string::utf8(
            b"The official Clan World crest. Art on Walrus, identity on Sui.",
        ),
        image_url: url::new_unsafe_from_bytes(IMAGE_URL),
        project_url: string::utf8(b"https://clanworld.wal.app"),
    };
    transfer::public_transfer(nft, ctx.sender());
}
