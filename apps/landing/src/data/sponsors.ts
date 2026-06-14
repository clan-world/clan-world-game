export interface SponsorPower {
  /** True name (modern brand) */
  name: string
  /** Lore name (in-world rendering) */
  loreName: string
  /** Logo URL — official logo where available; null = text treatment only */
  logoUrl: string | null
  /** Logo alt for a11y */
  logoAlt: string
  /** A short phrase as a pixel-text margin annotation */
  marginNote: string
  /** In-character description, ~2 sentences */
  loreDesc: string
  /** Technical reality, ~1-2 sentences */
  techDesc: string
  /** External link for the sponsor */
  href: string
}

export const POWERS: SponsorPower[] = [
  {
    name: 'Uniswap',
    loreName: 'The Unicorn Markets',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/e7/Uniswap_Logo.svg',
    logoAlt: 'Uniswap logo',
    marginNote: '← unicorn town liquidity',
    loreDesc:
      'In the bright pastel chaos of Unicorn Town, four pools forever hold their balance. Worth flows in, worth flows out, and the unicorns demand no fee but the slippage of careless traders.',
    techDesc:
      'Constant-product AMM pools seeded at deploy time. Wood, Iron, Wheat, and Fish each trade against Gold. Scheduled and immediate market actions resolve at heartbeat.',
    href: 'https://uniswap.org',
  },
  {
    name: 'KeeperHub',
    loreName: 'The World\'s Pulse',
    logoUrl: '/logos/keeperhub.jpg',
    logoAlt: 'KeeperHub',
    marginNote: '← onchain heartbeat',
    loreDesc:
      'Time itself is contracted out. Every minute, a faceless keeper rings the bell. Without them the world would freeze; with them, even the bandits march to schedule.',
    techDesc:
      'Cron-driven onchain workflow that calls the heartbeat() function at a fixed cadence and fires a webhook to the indexer. Permissionless and self-rate-limited.',
    href: 'https://app.keeperhub.io',
  },
  {
    name: 'Base',
    loreName: 'The Adamantine Foundation',
    logoUrl: '/logos/base.jpg',
    logoAlt: 'Base / Coinbase logo',
    marginNote: '← settlement layer',
    loreDesc:
      'The bedrock beneath the realm. Every vault, every wall, every grain of wheat — recorded here, beyond the reach of any single hand. The world may end, but the ledger endures.',
    techDesc:
      'L2 chain hosting the IClanWorld contract and all canonical game state. Cheap, fast, EVM-compatible. The single source of truth.',
    href: 'https://base.org',
  },
]
