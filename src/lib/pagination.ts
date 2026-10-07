/**
 * Paging and bulk-print rules, kept away from the component so they can be
 * reasoned about and tested on their own.
 *
 * Both archive views (pending and approved) read from the same helpers, so a
 * reader's chosen page size applies everywhere rather than resetting per view.
 */

/** Rows-per-page choices offered in the pager. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 150, 200] as const;

export const DEFAULT_PAGE_SIZE = 10;

/** Where the chosen page size is remembered between visits. */
export const PAGE_SIZE_STORAGE_KEY = "lh.pageSize";

/**
 * The most sheets sent to one print job.
 *
 * Each voucher is a full A4 sheet with a logo image. A few hundred of them in the
 * DOM at once makes the browser's print dialog grind to a halt, which reads as a
 * crash rather than a slow job. Refusing early with a way forward beats freezing
 * the tab, so a range is printed in successive jobs instead.
 */
export const MAX_PRINT_AT_ONCE = 100;

/** True when a value is one of the offered page sizes. */
export const isPageSize = (value: unknown): value is number =>
  typeof value === "number" && (PAGE_SIZE_OPTIONS as readonly number[]).includes(value);

/**
 * Coerces anything to a usable page size.
 *
 * Stored values arrive as strings and may be stale after this list changes, so
 * an unrecognised number falls back to the default rather than paging by 0 or by
 * something no longer offered.
 */
export const normalisePageSize = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return isPageSize(parsed) ? parsed : DEFAULT_PAGE_SIZE;
};

/** How many pages a list needs. Always at least one, so an empty list still has a page 1. */
export const pageCount = (total: number, pageSize: number): number =>
  Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));

/**
 * The rows for a page, clamped to the last page.
 *
 * Clamping matters because the page size and the filters can both change under a
 * reader who is on page 6; without it they would be shown an empty table.
 */
export const pageSlice = <T,>(rows: T[], page: number, pageSize: number): T[] => {
  const size = Math.max(1, pageSize);
  const pages = pageCount(rows.length, size);
  const current = Math.min(Math.max(1, page), pages);
  return rows.slice((current - 1) * size, current * size);
};

/** A short run of page numbers around the current one, with the ends clamped. */
export const pageNumbers = (current: number, total: number): number[] => {
  const pages: number[] = [];
  const last = Math.max(1, total);
  const here = Math.min(Math.max(1, current), last);
  const start = Math.max(1, Math.min(here - 2, Math.max(1, last - 4)));
  const end = Math.min(last, start + 4);
  for (let index = Math.max(1, end - 4); index <= end; index += 1) pages.push(index);
  return pages;
};

/**
 * Why a print job was refused, or "" when it can go ahead.
 *
 * Kept separate from the component so the wording is covered by a test and
 * cannot quietly drift into something vague.
 */
export const printBlocker = (count: number): string => {
  if (count <= 0) return "Select at least one voucher to print.";
  if (count <= MAX_PRINT_AT_ONCE) return "";
  return (
    `${count} vouchers is too many for a single print job, because each one is a full sheet of paper and ` +
    `the browser will stall on them. Narrow the date range to ${MAX_PRINT_AT_ONCE} vouchers or fewer, ` +
    `then print again.`
  );
};

/**
 * Reads the remembered page size.
 *
 * localStorage throws rather than returning null when storage is blocked, such
 * as in private browsing, so a failed read is simply the default.
 */
export const readStoredPageSize = (storage?: Pick<Storage, "getItem">): number => {
  try {
    return normalisePageSize(storage?.getItem(PAGE_SIZE_STORAGE_KEY));
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
};

/** Remembers the page size, ignoring a storage that refuses to be written. */
export const storePageSize = (value: number, storage?: Pick<Storage, "setItem">): void => {
  try {
    storage?.setItem(PAGE_SIZE_STORAGE_KEY, String(normalisePageSize(value)));
  } catch {
    // A reader without storage keeps the size for this visit only.
  }
};
