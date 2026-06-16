import { cn } from "@/lib/utils";

/**
 * Single source of truth for page content width. Every page/header/footer
 * routes through this so the layout stays consistent.
 *  - `content` — the standard single-column reading width (landing, lobby,
 *    draft room, brand, headers).
 *  - `wide`    — browse/grid pages that fan out on desktop (dashboard,
 *    competition). Same mobile width, expands at `lg`.
 * Padding stays with the caller (it varies per page); Container owns width only.
 */
const SIZES = {
  content: "max-w-3xl",
  wide: "max-w-3xl lg:max-w-6xl",
} as const;

type ContainerProps = React.HTMLAttributes<HTMLElement> & {
  as?: "div" | "main" | "header" | "section";
  size?: keyof typeof SIZES;
};

export function Container({
  as: Tag = "div",
  size = "content",
  className,
  ...props
}: ContainerProps) {
  return (
    <Tag className={cn("mx-auto w-full", SIZES[size], className)} {...props} />
  );
}
