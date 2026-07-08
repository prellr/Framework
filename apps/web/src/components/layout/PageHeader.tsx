import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** Refresh buttons, badges, status text — rendered on the right (desktop) or below title (mobile) */
  actions?: ReactNode;
  className?: string;
}

/**
 * Consistent page-level heading with responsive layout:
 * - Mobile: title + subtitle centred, actions stacked below
 * - Desktop (md+): title left, actions right
 */
export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 md:flex-row md:items-center md:justify-between",
        className,
      )}
    >
      <div className="text-center md:text-left">
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-3">{actions}</div>}
    </div>
  );
}
