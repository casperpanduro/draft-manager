import { avatarSpec, type AvatarSpec, type HairStyle, type Facial } from "@/lib/avatar";
import { cn } from "@/lib/utils";

const EYE = "#2a221c";

function Hair({ style, color }: { style: HairStyle; color: string }) {
  switch (style) {
    case "bald":
      return null;
    case "buzz":
      return (
        <path
          d="M20 26 C20 15 26 13 32 13 C38 13 44 15 44 26 C44 20 39 18 32 18 C25 18 20 20 20 26 Z"
          fill={color}
          opacity={0.92}
        />
      );
    case "short":
      return (
        <path
          d="M19 28 C19 14 26 12 32 12 C38 12 45 14 45 28 C45 20 40 18.5 32 18.5 C24 18.5 19 20 19 28 Z"
          fill={color}
        />
      );
    case "curly":
      return (
        <g fill={color}>
          {[
            [22, 17],
            [27, 13],
            [32, 12],
            [37, 13],
            [42, 17],
            [19, 22],
            [45, 22],
          ].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r={4.4} />
          ))}
          <path d="M19 24 C19 18 25 17 32 17 C39 17 45 18 45 24 L45 20 L19 20 Z" />
        </g>
      );
    case "afro":
      return (
        <path
          d="M15 31 C15 9 24 7 32 7 C40 7 49 9 49 31 C49 20 41 18 32 18 C23 18 15 20 15 31 Z"
          fill={color}
        />
      );
    case "long":
      return (
        <path
          d="M19 25 Q19 13 32 13 Q45 13 45 25 L45 39 Q43 41 41.5 39 L41.5 26 Q41.5 20 32 20 Q22.5 20 22.5 26 L22.5 39 Q21 41 19 39 Z"
          fill={color}
        />
      );
    case "mohawk":
      return (
        <path
          d="M28.5 11 Q32 9 35.5 11 L35 24 Q32 25 29 24 Z"
          fill={color}
        />
      );
  }
}

function FacialHair({ kind, color }: { kind: Facial; color: string }) {
  switch (kind) {
    case "none":
      return null;
    case "stubble":
      return (
        <path
          d="M21 29 Q22 41 32 41 Q42 41 43 29 Q40 35 32 35 Q24 35 21 29 Z"
          fill={color}
          opacity={0.28}
        />
      );
    case "beard":
      return (
        <path
          d="M20.5 28 Q21 42 32 42.5 Q43 42 43.5 28 Q40 35 32 35 Q24 35 20.5 28 Z"
          fill={color}
          opacity={0.95}
        />
      );
    case "moustache":
      return <rect x={28.5} y={31} width={7} height={1.8} rx={0.9} fill={color} />;
  }
}

function AvatarSvg({ spec }: { spec: AvatarSpec }) {
  const { skin, hairStyle, hairColor, facial, kit } = spec;
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden>
      {/* kit background */}
      <rect width="64" height="64" fill={kit.primary} />
      <ellipse cx="32" cy="20" rx="36" ry="30" fill="#ffffff" opacity="0.12" />
      <ellipse cx="32" cy="62" rx="42" ry="26" fill="#000000" opacity="0.2" />
      {/* shoulders / jersey */}
      <path d="M7 64 C7 50 19 45 32 45 C45 45 57 50 57 64 Z" fill={kit.primary} />
      <path
        d="M7 64 C7 50 19 45 32 45 C45 45 57 50 57 64 Z"
        fill="#ffffff"
        opacity="0.14"
      />
      {/* collar */}
      <path
        d="M26 45 L32 52 L38 45"
        fill="none"
        stroke={kit.secondary}
        strokeWidth="2.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* neck */}
      <rect x="27.5" y="37" width="9" height="10" fill={skin} />
      <rect x="27.5" y="37" width="9" height="3" fill="#000" opacity="0.12" />
      {/* ears */}
      <circle cx="20" cy="30" r="3.2" fill={skin} />
      <circle cx="44" cy="30" r="3.2" fill={skin} />
      {/* head */}
      <ellipse cx="32" cy="27" rx="12" ry="13" fill={skin} />
      {/* facial hair sits on the jaw, under the eyes */}
      <FacialHair kind={facial} color={hairColor} />
      {/* eyes + brows */}
      <ellipse cx="27.5" cy="27.5" rx="1.5" ry="2" fill={EYE} />
      <ellipse cx="36.5" cy="27.5" rx="1.5" ry="2" fill={EYE} />
      <rect x="25" y="23" width="4.6" height="1.4" rx="0.7" fill={hairColor} />
      <rect x="34.4" y="23" width="4.6" height="1.4" rx="0.7" fill={hairColor} />
      {/* hair on top */}
      <Hair style={hairStyle} color={hairColor} />
    </svg>
  );
}

export function PlayerAvatar({
  name,
  club,
  size = 40,
  className,
}: {
  name: string;
  club: string;
  size?: number;
  className?: string;
}) {
  const spec = avatarSpec(`${name}|${club}`, club);
  return (
    <span
      className={cn(
        "inline-block shrink-0 overflow-hidden rounded-full ring-1 ring-white/15",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <AvatarSvg spec={spec} />
    </span>
  );
}
