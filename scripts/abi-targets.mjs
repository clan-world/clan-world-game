import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, '..');

/**
 * Canonical list of contract ABI artifacts that ship in `packages/contracts/abi/`.
 *
 * Both the generator (`scripts/gen-contract-abi.mjs`) and the checker
 * (`packages/contracts/scripts/check-contract-abi.mjs`) import this list so the
 * two can never drift. Adding a new exported ABI requires exactly one edit here.
 *
 * `sourcePath` is relative to `packages/contracts/` and is the input to `forge build`.
 */
export const abiTargets = [
  {
    sourcePath: 'src/IClanWorld.sol',
    artifactPath: path.join(repoRoot, 'packages/contracts/out/IClanWorld.sol/IClanWorld.json'),
    targetPath: path.join(repoRoot, 'packages/contracts/abi/IClanWorld.json'),
  },
  {
    sourcePath: 'src/IClanWorldLens.sol',
    artifactPath: path.join(repoRoot, 'packages/contracts/out/IClanWorldLens.sol/IClanWorldLens.json'),
    targetPath: path.join(repoRoot, 'packages/contracts/abi/IClanWorldLens.json'),
  },
  // Diamond / Ownership facet ABIs consumed by apps/dev-ui (generic write/read UI over the
  // ClanWorld diamond). Kept canonical here so dev-ui never vendors a stale copy.
  {
    sourcePath: 'src/diamond/IDiamondLoupe.sol',
    artifactPath: path.join(repoRoot, 'packages/contracts/out/IDiamondLoupe.sol/IDiamondLoupe.json'),
    targetPath: path.join(repoRoot, 'packages/contracts/abi/IDiamondLoupe.json'),
  },
  {
    sourcePath: 'src/diamond/IDiamondCut.sol',
    artifactPath: path.join(repoRoot, 'packages/contracts/out/IDiamondCut.sol/IDiamondCut.json'),
    targetPath: path.join(repoRoot, 'packages/contracts/abi/IDiamondCut.json'),
  },
  {
    sourcePath: 'src/diamond/facets/OwnershipFacet.sol',
    artifactPath: path.join(repoRoot, 'packages/contracts/out/OwnershipFacet.sol/OwnershipFacet.json'),
    targetPath: path.join(repoRoot, 'packages/contracts/abi/OwnershipFacet.json'),
  },
];
