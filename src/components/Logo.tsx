import { branchBrand } from "@/lib/brand";

type Props = {
  variant?: "red" | "white";
  /**
   * Which branch's mark to show, as its `companies.code`.
   *
   * Omit it and you get Longhorn Associates, which is right for the sign-in page
   * where nobody has said who they are yet.
   */
  branchCode?: string | null;
  /** Overrides the alt text, which otherwise comes from the branch code. */
  branchName?: string | null;
  height?: number;
  className?: string;
};

/**
 * The Longhorn logo.
 *
 * Only the Associates mark has a white variant, because it is the only one that
 * has ever been needed on the dark sign-in panel. A branch without a white mark
 * falls back to its colour one, which is correct on every light surface.
 */
const Logo = ({ variant = "red", branchCode, branchName, height = 40, className = "" }: Props) => {
  const brand = branchBrand(branchCode);
  // The sign-in page is not signed in yet, so there is no branch to show and the
  // group mark is the only one that can be right.
  const src = variant === "white" && !branchCode ? "/logo-white.png" : brand.logo;

  return (
    <img
      src={src}
      alt={branchName || brand.name}
      height={height}
      className={`official-logo ${className}`}
      style={{ height, width: "auto" }}
    />
  );
};

export default Logo;
