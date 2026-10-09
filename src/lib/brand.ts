/**
 * Which logo each branch trades under.
 *
 * The three Longhorn arms have their own marks, so the logo shown anywhere is
 * decided by the branch the page belongs to. Keyed on `companies.code` rather
 * than on the name, because the code is the one thing both a signed-in person
 * and a voucher carry, and a name is free text that an admin can change from
 * the admin panel without anyone noticing the logo stopped matching.
 */

export type BranchBrand = {
  code: string;
  name: string;
  logo: string;
};

const ASSOCIATES: BranchBrand = {
  code: "LA",
  name: "Longhorn Associates",
  logo: "/logo-red.png",
};

const BRANDS: Record<string, BranchBrand> = {
  LA: ASSOCIATES,
  LFS: { code: "LFS", name: "Longhorn Financial Services", logo: "/logo-lfs.png" },
  LIB: { code: "LIB", name: "Longhorn Insurance Brokers", logo: "/logo-lib.png" },
};

/**
 * The brand for a branch code, falling back to Longhorn Associates.
 *
 * The fallback is deliberate and is the safe direction: a voucher with no branch
 * set, or one raised before a branch existed, still prints on the group's own
 * paper rather than on nothing at all.
 */
export const branchBrand = (code?: string | null): BranchBrand => {
  const match = code ? BRANDS[code.trim().toUpperCase()] : undefined;
  return match ?? ASSOCIATES;
};