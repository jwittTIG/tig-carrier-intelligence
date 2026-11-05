import type { EffectiveState, Freshness } from "@/lib/dates";
import { EFFECTIVE_LABEL } from "@/lib/dates";
import { Badge, fmtDate } from "./ui";

export function FreshnessBadge({ f }: { f: Freshness }) {
  if (f.state === "NEVER_VERIFIED") return <Badge tone="warn">Never confirmed</Badge>;
  if (f.state === "STALE") return <Badge tone="warn">Stale: review was due {fmtDate(f.nextReviewAt)}</Badge>;
  return <Badge tone="good">Confirmed · next review {fmtDate(f.nextReviewAt)}</Badge>;
}

export function EffectiveBadge({ state }: { state: EffectiveState }) {
  const tone = state === "CURRENT" ? "good" : state === "EXPIRING_SOON" ? "warn" : state === "EXPIRED" ? "bad" : "neutral";
  return <Badge tone={tone}>{EFFECTIVE_LABEL[state]}</Badge>;
}
