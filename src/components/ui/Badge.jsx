import React from "react";

const VARIANTS = {
  neutral: "bg-muted text-foreground border-border",
  info: "bg-info-wash text-info border-info/30",
  accent: "bg-info-wash text-primary border-primary/30",
  success: "bg-success-wash text-success border-success/30",
  warning: "bg-warning-wash text-warning border-warning/40",
  danger: "bg-danger-wash text-destructive border-destructive/30",
  solid: "bg-ink text-instrument-foreground border-ink",
};

/** Status / severity pill. Every variant pairs a pale tint with a dark text shade (>= 4.5:1). */
export default function Badge({ variant = "neutral", icon: Icon, className = "", children }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 ${VARIANTS[variant] || VARIANTS.neutral} ${className}`}
    >
      {Icon && <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />}
      {children}
    </span>
  );
}
