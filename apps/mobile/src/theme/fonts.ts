import {
  Cinzel_500Medium,
  Cinzel_600SemiBold,
  Cinzel_700Bold,
} from '@expo-google-fonts/cinzel';
import {
  CormorantGaramond_400Regular_Italic,
  CormorantGaramond_500Medium_Italic,
  CormorantGaramond_600SemiBold_Italic,
} from '@expo-google-fonts/cormorant-garamond';
import {
  EBGaramond_400Regular,
  EBGaramond_500Medium,
  EBGaramond_600SemiBold,
  EBGaramond_400Regular_Italic,
} from '@expo-google-fonts/eb-garamond';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
} from '@expo-google-fonts/jetbrains-mono';

/**
 * Font map fed to `useFonts` in the root layout. Keys MUST match the family
 * strings used in `tokens.ts#font` — RN resolves fonts by exact-string.
 *
 * Four families per the design archive:
 *   - Cinzel                 → display (h1/h2/h3, all uppercase metallic)
 *   - Cormorant Garamond IT  → script (italicized flourishes, blue ink)
 *   - EB Garamond            → body (parchment-friendly serif)
 *   - JetBrains Mono         → mono (numerics, addresses, ticks)
 */
export const fontMap = {
  Cinzel_500Medium,
  Cinzel_600SemiBold,
  Cinzel_700Bold,
  CormorantGaramond_400Regular_Italic,
  CormorantGaramond_500Medium_Italic,
  CormorantGaramond_600SemiBold_Italic,
  EBGaramond_400Regular,
  EBGaramond_500Medium,
  EBGaramond_600SemiBold,
  EBGaramond_400Regular_Italic,
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
} as const;
