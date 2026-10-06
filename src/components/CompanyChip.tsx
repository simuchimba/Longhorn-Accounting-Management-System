type CompanyChipProps = {
  name?: string | null;
  code?: string | null;
  color?: string | null;
  /** `full` shows the branch name, `code` shows just the short label. */
  variant?: "full" | "code";
  className?: string;
};

/**
 * The branch a voucher or a person belongs to.
 *
 * Every branch gets its own colour from the admin panel, so a preparer can tell at
 * a glance whether a row in their list came from Longhorn Associates or from one
 * of the other two companies.
 */
const CompanyChip = ({ name, code, color, variant = "code", className = "" }: CompanyChipProps) => {
  const tint = color || "#8490a5";

  if (!name && !code) {
    return (
      <span className={`company-chip company-chip-unset ${className}`} title="No branch assigned">
        Unassigned
      </span>
    );
  }

  if (variant === "full") {
    return (
      <span className={`company-chip ${className}`} style={{ background: `${tint}12`, color: tint, borderColor: `${tint}33` }}>
        <i style={{ background: tint }} />
        {name}
      </span>
    );
  }

  return (
    <span className={`company-chip company-chip-code ${className}`} style={{ background: `${tint}12`, color: tint, borderColor: `${tint}33` }} title={name ?? undefined}>
      <i style={{ background: tint }} />
      {code || "—"}
    </span>
  );
};

export default CompanyChip;