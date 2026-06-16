// Deterministic procedural player avatars. Same player → same face, every
// time. No assets, no deps — just a seeded pick from curated palettes, with
// the kit tinted to the player's national-team colours.

export type AvatarSpec = {
  skin: string;
  hairStyle: HairStyle;
  hairColor: string;
  facial: Facial;
  kit: { primary: string; secondary: string };
};

export type HairStyle =
  | "bald"
  | "buzz"
  | "short"
  | "curly"
  | "afro"
  | "long"
  | "mohawk";
export type Facial = "none" | "stubble" | "beard" | "moustache";

const SKIN = ["#f4d4b6", "#e8b88f", "#d49a6a", "#b0744a", "#855232", "#5e3a23"];
const HAIR = ["#15110d", "#3a2a1a", "#6b4423", "#9a5a2b", "#caa84a", "#9aa0a6", "#e6e1d6"];
const HAIR_STYLES: HairStyle[] = [
  "bald",
  "buzz",
  "short",
  "short",
  "curly",
  "afro",
  "long",
  "mohawk",
];
const FACIAL: Facial[] = [
  "none",
  "none",
  "none",
  "none",
  "stubble",
  "beard",
  "moustache",
];

// Iconic colour per World Cup nation (primary used for the kit/back circle,
// secondary for collar trim). Unknown clubs fall back to a hashed hue.
const NATION_KITS: Record<string, [string, string]> = {
  Argentina: ["#6CACE4", "#ffffff"],
  France: ["#1f2a78", "#ffffff"],
  Brazil: ["#f7d417", "#1f9d4d"],
  England: ["#e8eaf0", "#cf142b"],
  Spain: ["#b81d2c", "#f7d417"],
  Portugal: ["#c8202f", "#0a6b35"],
  Netherlands: ["#f1670f", "#ffffff"],
  Germany: ["#2b2b2f", "#e7e7e7"],
  Belgium: ["#d8202f", "#f3c300"],
  Croatia: ["#d8202f", "#ffffff"],
  Italy: ["#1f6fb0", "#ffffff"],
  USA: ["#2b2a55", "#bf2435"],
  Mexico: ["#0a7a4a", "#ffffff"],
  Uruguay: ["#5bb8e8", "#1f2a55"],
  Colombia: ["#f7d417", "#1f4ea1"],
  Morocco: ["#0a6b35", "#c8202f"],
  Japan: ["#23306b", "#ffffff"],
  Senegal: ["#1f9d4d", "#f7d417"],
  Denmark: ["#c8202f", "#ffffff"],
  Switzerland: ["#d8202f", "#ffffff"],
  Serbia: ["#b81d2c", "#1f3a73"],
  Poland: ["#d8202f", "#ffffff"],
  "South Korea": ["#c8313b", "#1f3a8a"],
  Canada: ["#d8202f", "#ffffff"],
  Ecuador: ["#f7d417", "#1f4ea1"],
  Nigeria: ["#0a8a4a", "#ffffff"],
  Ghana: ["#0a7a3f", "#f3c300"],
  Cameroon: ["#0a7a4a", "#c8202f"],
  Australia: ["#f3c300", "#0a6b35"],
  Norway: ["#b81d2c", "#1f3a73"],
  Sweden: ["#f7d417", "#1f4ea1"],
  Egypt: ["#c8202f", "#1a1a1a"],
};

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Small deterministic PRNG (mulberry32) seeded from the hash.
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(arr: T[], r: number) => arr[Math.floor(r * arr.length)];

export function teamKit(club: string): { primary: string; secondary: string } {
  const found = NATION_KITS[club];
  if (found) return { primary: found[0], secondary: found[1] };
  const hue = hash(club) % 360;
  return { primary: `hsl(${hue} 55% 45%)`, secondary: "#ffffff" };
}

export function avatarSpec(seed: string, club: string): AvatarSpec {
  const r = rng(hash(seed));
  return {
    skin: pick(SKIN, r()),
    hairStyle: pick(HAIR_STYLES, r()),
    hairColor: pick(HAIR, r()),
    facial: pick(FACIAL, r()),
    kit: teamKit(club),
  };
}
