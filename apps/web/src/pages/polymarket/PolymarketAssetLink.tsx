import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

export const POLYMARKET_ASSETS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB"] as const;
export type PolymarketAsset = (typeof POLYMARKET_ASSETS)[number];

export function polymarketAsset(value: string): PolymarketAsset | null {
  const asset = value.replace("-USD", "").trim().toUpperCase();
  return POLYMARKET_ASSETS.includes(asset as PolymarketAsset)
    ? asset as PolymarketAsset
    : null;
}

export function PolymarketAssetLink({
  asset: value,
  scope,
  period,
  horizonMin,
  className,
  children,
}: {
  asset: string;
  scope?: "paper" | "forward" | "history";
  period?: "24h" | "3d" | "7d" | "30d" | "all";
  horizonMin?: number;
  className?: string;
  children?: ReactNode;
}) {
  const asset = polymarketAsset(value);
  if (!asset) return <>{children ?? value}</>;
  const horizon = horizonMin === 15 ? 15 : horizonMin === 5 ? 5 : undefined;

  return (
    <Link
      to="/polymarket/asset/$asset"
      params={{ asset }}
      search={{ scope, period, horizon }}
      onClick={(event) => event.stopPropagation()}
      className={className ?? "rounded-sm transition-colors hover:text-primary hover:underline hover:underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"}
    >
      {children ?? asset}
    </Link>
  );
}
