/**
 * Presentation-only helpers for the Templates admin screens.
 *
 * Pure functions — no Supabase client, no React, no business rules. They only
 * support table sorting/paging and the read-only sample payload used by the
 * in-browser preview (never persisted, never sent to a provider).
 */
import { extractTokenPaths } from "@/platform/omni-comms/rendering";

export type SortDirection = "asc" | "desc";
export interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

export function toggleSort<K extends string>(current: SortState<K>, key: K): SortState<K> {
  if (current.key !== key) return { key, direction: "asc" };
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}

/** Stable, locale-aware sort over an already-loaded page of rows. */
export function sortRows<T, K extends string>(
  rows: T[],
  sort: SortState<K>,
  valueOf: (row: T, key: K) => string | number | null | undefined,
): T[] {
  const factor = sort.direction === "asc" ? 1 : -1;
  return [...rows]
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const av = valueOf(a.row, sort.key);
      const bv = valueOf(b.row, sort.key);
      if (av == null && bv == null) return a.index - b.index;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
      return cmp !== 0 ? cmp * factor : a.index - b.index;
    })
    .map((entry) => entry.row);
}

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export interface PageSlice<T> {
  rows: T[];
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
}

export function paginate<T>(rows: T[], page: number, pageSize: number): PageSlice<T> {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = (safePage - 1) * pageSize;
  const slice = rows.slice(start, start + pageSize);
  return {
    rows: slice,
    page: safePage,
    pageCount,
    total,
    from: total === 0 ? 0 : start + 1,
    to: start + slice.length,
  };
}

/** "payload.subjectName" → "Subject Name" */
function humanise(path: string): string {
  const leaf = path.split(".").pop() ?? path;
  return leaf
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".").filter(Boolean);
  let node = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (typeof node[key] !== "object" || node[key] === null) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
}

/**
 * Builds a complete synthetic payload covering EVERY token referenced by the
 * template content, so the preview renders instead of failing on the first
 * missing token. Values are obvious placeholders, never real data.
 */
export function buildSamplePayload(content: Record<string, string>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of Object.values(content ?? {})) {
    let paths: string[] = [];
    try {
      paths = extractTokenPaths(field ?? "");
    } catch {
      paths = [];
    }
    for (const path of paths) setPath(payload, path, `[${humanise(path)}]`);
  }
  return payload;
}
