/**
 * Keyset pagination. A page continues after the item whose id is `after`, in the list's
 * own order, so inserts and deletes between requests never repeat or skip an item.
 */
export interface PageRequest {
  limit: number;
  /** The id of the last item on the previous page, or null for the first page. */
  after: string | null;
}

export interface Page<T> {
  items: T[];
  /** The id to pass as `after` for the next page, or null on the last page. */
  nextAfter: string | null;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** The query a use case sends to the repo: one extra row tells it whether more follow. */
export const probe = (page: PageRequest): PageRequest => ({
  limit: page.limit + 1,
  after: page.after,
});

/** Trims the probe row and records where the next page starts. */
export function toPage<R extends { id: string }, T>(
  rows: readonly R[],
  page: PageRequest,
  map: (row: R) => T,
): Page<T> {
  const items = rows.slice(0, page.limit);
  const more = rows.length > page.limit;
  return { items: items.map(map), nextAfter: more ? (items.at(-1)?.id ?? null) : null };
}
