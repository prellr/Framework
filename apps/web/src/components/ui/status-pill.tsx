import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "muted" | "destructive";

const TONE: Record<Tone, string> = {
  success: "bg-success/12 text-success ring-success/25",
  warning: "bg-warning/15 text-warning ring-warning/30",
  muted: "bg-muted text-muted-foreground ring-border",
  destructive: "bg-destructive/12 text-destructive ring-destructive/25",
};

interface StatusPillProps {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}

/**
 * A small status indicator whose motion carries meaning: it spring-pops each time
 * the displayed value changes (keyed on children), so a state transition reads as a
 * transition — not a silent swap. Motion is information (Fluid Functionalism).
 */
export function StatusPill({ tone, children, className }: StatusPillProps) {
  const key = React.useMemo(() => JSON.stringify(children), [children]);
  return (
    <span
      key={key}
      className={cn(
        "animate-spring-pop inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
