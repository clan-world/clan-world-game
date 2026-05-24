import { randomBytes } from "node:crypto";

const THEMES = [
  ["booming", "hushed", "silver", "northward", "lantern", "thicket", "ember", "distant", "hollow", "bright", "quiet", "echoing"],
  ["morning", "lark", "swooping", "sigh", "midnight", "raven", "calling", "dawn", "velvet", "sunset", "watchful", "song"],
  ["stormbound", "fox", "creeping", "whisper", "rainlit", "mist", "thunder", "drizzle", "gale", "cloud", "frost", "murmur"],
  ["autumn", "marsh", "otter", "summoning", "winter", "ridge", "spring", "brook", "summer", "meadow", "root", "bloom"],
  ["wistful", "moonlit", "stoat", "summons", "solar", "ashen", "comet", "tender", "brave", "solemn", "starry", "call"],
  ["crimson", "quartz", "magpie", "warning", "azure", "iron", "verdant", "amber", "copper", "jade", "scarlet", "chime"],
] as const;

export function generateThematicUid(): string {
  const theme = THEMES[randomInt(THEMES.length)] ?? THEMES[0];
  const words = pickRandom(theme, 3);
  return `${words.join("-")}-${randomHex(4)}`;
}

export async function generateUniqueThematicUid(
  isTaken: (uid: string) => Promise<boolean>,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const uid = generateThematicUid();
    if (!(await isTaken(uid))) return uid;
  }
  throw new Error("thematic UID collision after 5 retries");
}

export function themeCount(): number {
  return THEMES.length;
}

function pickRandom(words: readonly string[], count: number): string[] {
  const picked: string[] = [];
  while (picked.length < count) {
    const word = words[randomInt(words.length)];
    if (word && !picked.includes(word)) picked.push(word);
  }
  return picked;
}

function randomHex(chars: number): string {
  return randomBytes(Math.ceil(chars / 2)).toString("hex").slice(0, chars);
}

function randomInt(maxExclusive: number): number {
  return randomBytes(4).readUInt32BE(0) % maxExclusive;
}
