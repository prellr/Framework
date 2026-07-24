import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

export type SortDirection = "asc" | "desc";
export type SortState<Key extends string> = {
  key: Key;
  direction: SortDirection;
};
export type SortValue = string | number | boolean | null | undefined;

export function nextSortState<Key extends string>(
  current: SortState<Key>,
  key: Key,
  initialDirection: SortDirection = "desc",
): SortState<Key> {
  return current.key === key
    ? { key, direction: current.direction === "desc" ? "asc" : "desc" }
    : { key, direction: initialDirection };
}

export function compareSortValues(
  left: SortValue,
  right: SortValue,
  direction: SortDirection,
): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;

  const compared =
    typeof left === "string" || typeof right === "string"
      ? String(left).localeCompare(String(right), undefined, {
          numeric: true,
          sensitivity: "base",
        })
      : Number(left) - Number(right);
  return direction === "asc" ? compared : -compared;
}

export function stableSortRows<Row>(
  rows: readonly Row[],
  value: (row: Row) => SortValue,
  direction: SortDirection,
): Row[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (left, right) =>
        compareSortValues(value(left.row), value(right.row), direction)
        || left.index - right.index,
    )
    .map(({ row }) => row);
}

export function PolymarketSortableHeader<Key extends string>({
  column,
  active,
  direction,
  onSort,
  children,
  align = "left",
  className = "",
  title,
  initialDirection = "desc",
}: {
  column: Key;
  active: Key;
  direction: SortDirection;
  onSort: (column: Key, initialDirection?: SortDirection) => void;
  children: ReactNode;
  align?: "left" | "center" | "right";
  className?: string;
  title?: string;
  initialDirection?: SortDirection;
}) {
  const selected = active === column;
  const Icon = selected
    ? direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ChevronsUpDown;
  const justify =
    align === "right"
      ? "justify-end text-right"
      : align === "center"
        ? "justify-center text-center"
        : "justify-start text-left";

  return (
    <th
      className={className}
      aria-sort={selected ? (direction === "asc" ? "ascending" : "descending") : "none"}
      title={title}
    >
      <button
        type="button"
        onClick={() => onSort(column, initialDirection)}
        className={`group flex w-full items-center gap-1 rounded-sm font-[inherit] text-[inherit] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${justify}`}
        title={title}
      >
        <span>{children}</span>
        <Icon
          aria-hidden="true"
          className={`h-3 w-3 shrink-0 transition-opacity ${
            selected ? "opacity-90" : "opacity-0 group-hover:opacity-45 group-focus-visible:opacity-45"
          }`}
        />
      </button>
    </th>
  );
}
