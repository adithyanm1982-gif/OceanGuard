import React from "react";

/** Standard surface: white panel with hairline border and shadow-panel. `tone="wash"` gives an inset well. */
export default function Card({
  as: Tag = "div",
  tone = "surface",
  padded = true,
  className = "",
  children,
  ...rest
}) {
  const surface = tone === "wash" ? "bg-wash border-border" : "bg-card border-border shadow-panel";
  return (
    <Tag className={`rounded-lg border ${surface} ${padded ? "p-5" : ""} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
