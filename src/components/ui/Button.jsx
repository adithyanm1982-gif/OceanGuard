import React from "react";

const VARIANTS = {
  primary: "bg-primary hover:bg-buoy-dark text-primary-foreground border-transparent",
  secondary: "bg-card hover:bg-muted text-foreground border-border",
  selected: "bg-accent text-accent-foreground border-primary",
  ghost: "bg-transparent hover:bg-muted text-foreground border-transparent",
  danger: "bg-card hover:bg-danger-wash text-destructive border-destructive",
  onDark:
    "bg-transparent hover:bg-instrument-hover text-instrument-muted hover:text-instrument-foreground border-transparent",
};
const SIZES = {
  sm: "text-xs px-2.5 py-1.5 gap-1.5",
  md: "text-sm px-3.5 py-2 gap-2",
  lg: "text-sm px-4 py-3 gap-2",
};

export default function Button({
  variant = "primary",
  size = "md",
  icon: Icon,
  block = false,
  className = "",
  type = "button",
  children,
  ...rest
}) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant] || VARIANTS.primary} ${SIZES[size]} ${block ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {Icon && <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />}
      {children}
    </button>
  );
}
