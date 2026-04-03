import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const TIER_COLORS: Record<1 | 2 | 3 | 4, string> = {
  1: "bg-tier-1 text-white border-tier-1",
  2: "bg-tier-2 text-white border-tier-2",
  3: "bg-tier-3 text-white border-tier-3",
  4: "bg-tier-4 text-white border-tier-4",
};

interface TierBadgeProps {
  tier: 1 | 2 | 3 | 4;
  className?: string;
}

export function TierBadge({ tier, className }: TierBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border font-semibold",
        TIER_COLORS[tier],
        className
      )}
    >
      Tier {tier}
    </Badge>
  );
}
