import { PAGE_SIZE_OPTIONS, pageNumbers } from "@/lib/pagination";

type Props = {
  /** Rows matching the current filters, across every page. */
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  /** Noun for the row summary, e.g. "records". */
  noun?: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

/**
 * The pager under an archive table.
 *
 * The rows-per-page picker is shown whenever there is anything to page through,
 * not only when the list overflows. Hiding it until there are too many rows would
 * mean a reader with eight records never discovers the setting exists, which is
 * exactly the person who needs to reach 200 later.
 */
const PaginationBar = ({
  total,
  page,
  pages,
  pageSize,
  noun = "records",
  onPageChange,
  onPageSizeChange,
}: Props) => {
  if (total <= 0) return null;

  // Only offer the jump-to-page buttons once they save a click; with a handful of
  // pages, Previous and Next are enough.
  const numbers = pages > 7 ? pageNumbers(page, pages) : [];
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="pagination-bar">
      <span className="page-info">
        {pages > 1 ? `${from}–${to} of ${total} ${noun} · page ${page} of ${pages}` : `${total} ${noun}`}
      </span>

      <div className="pager-controls">
        <label className="page-size">
          <span>Rows</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            title="Rows shown per page"
            aria-label="Rows shown per page"
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>

        {(pages > 1 || numbers.length > 0) && (
          <div className="page-buttons">
            <button className="page-button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</button>
            {numbers.map((number) => (
              <button
                key={number}
                className={`page-button${number === page ? " page-button-active" : ""}`}
                aria-current={number === page ? "page" : undefined}
                onClick={() => onPageChange(number)}
              >
                {number}
              </button>
            ))}
            <button className="page-button" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PaginationBar;
