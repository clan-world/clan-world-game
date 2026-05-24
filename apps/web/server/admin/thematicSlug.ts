const WEATHER = [
  "mist", "thunder", "frost", "rain", "cloud", "gale", "ember", "snow",
  "storm", "dawn", "dusk", "hail",
];
const MYTHOLOGY = [
  "oracle", "rune", "wyrd", "aegis", "nymph", "titan", "saga", "relic",
  "altar", "omen", "spire", "crown",
];
const GEMSTONES = [
  "amber", "opal", "onyx", "jade", "ruby", "beryl", "topaz", "quartz",
  "agate", "pearl", "garnet", "coral",
];
const SEASONS = [
  "spring", "summer", "autumn", "winter", "solstice", "harvest", "bloom",
  "thaw", "embertide", "fallow", "midsun", "firstsnow",
];
const TERRAIN = [
  "oak", "river", "stone", "grove", "valley", "peak", "marsh", "field",
  "ridge", "meadow", "cairn", "cliff",
];
const COLORS_FEELINGS = [
  "crimson", "gold", "silver", "violet", "brave", "quiet", "bright",
  "ashen", "verdant", "kind", "wild", "keen",
];

const THEMES = [WEATHER, MYTHOLOGY, GEMSTONES, SEASONS, TERRAIN, COLORS_FEELINGS];

function pickRandom(words: readonly string[], count: number): string[] {
  const picked: string[] = [];
  for (let i = 0; i < count; i += 1) {
    picked.push(words[Math.floor(Math.random() * words.length)]!);
  }
  return picked;
}

function randomHex(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

export function generateThematicSlug(): string {
  const theme = THEMES[Math.floor(Math.random() * THEMES.length)]!;
  const words = pickRandom(theme, 3);
  const hex = randomHex(4);
  // TODO(post-PR2): migrate to shared utility from packages/shared/src/thematicUid.ts.
  return `${words.join("-")}-${hex}`;
}
