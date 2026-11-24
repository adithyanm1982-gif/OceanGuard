import React from "react";

const TONES = {
  default: "text-ink",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  accent: "text-primary",
};

/** Label above a tabular-numeral value. `compact` renders a single-line label/value pair. */
export default function StatTile({
  label,
  value,
  unit,
  hint,
  tone = "default",
  compact = false,
  className = "",
}) {
  if (compact) {
    return (
      <div className={`flex items-baseline gap-1.5 min-w-0 ${className}`}>
        <span className="text-xs text-muted-foreground shrink-0">{label}</span>
        <span className={`font-mono text-xs font-medium truncate ${TONES[tone]}`}>
          {value}
          {unit && <span className="text-muted-foreground"> {unit}</span>}
        </span>
      </div>
    );
  }
  return (
    <div className={`rounded-md bg-wash border border-border p-3 ${className}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono tabular-nums text-xl font-semibold ${TONES[tone]}`}>
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
