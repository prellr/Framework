import { useState } from "react";
import { Copy, Check } from "lucide-react";

/** Jester's parameter code with click-to-copy (paste into Jester to load the exact params). */
export function CopyCode({ code, label = "Jester code" }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs hover:bg-accent"
      title="Jester parameter code — click to copy"
    >
      {label && <span className="text-muted-foreground">{label}</span>}
      {code}
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
    </button>
  );
}
