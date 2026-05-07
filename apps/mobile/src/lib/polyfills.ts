/**
 * Solana web3.js + Buffer polyfills. MUST be imported at the very top of the
 * app entry (before any code that touches @solana/web3.js or Buffer). The
 * import order matters — this file has no exports because the side effects
 * are the whole point.
 */

import 'react-native-get-random-values';
import { Buffer } from 'buffer';

declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var Buffer: typeof import('buffer').Buffer;
}

if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}
