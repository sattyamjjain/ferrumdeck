"use client";

import * as React from "react";
import {
  ColumnDef,
  ColumnOrderState,
  ColumnResizeMode,
  ColumnSizingState,
  Row,
  RowSelectionState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type TableOptions,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { TableIcon } from "lucide-react";

// ============================================================================
// Types
// ============================================================================

export type DensityMode = "comfortable" | "compact";

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];

  // Selection
  enableRowSelection?: boolean | ((row: Row<TData>) => boolean);
  enableMultiRowSelection?: boolean;
  onRowSelectionChange?: (selection: RowSelectionState) => void;
  rowSelection?: RowSelectionState;

  // Sorting
  enableSorting?: boolean;
  defaultSorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;

  // Column features
  enableColumnResizing?: boolean;
  enableColumnReordering?: boolean;
  columnResizeMode?: ColumnResizeMode;
  defaultColumnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (visibility: VisibilityState) => void;

  // Virtualization
  enableVirtualization?: boolean;
  estimateRowHeight?: number;
  overscan?: number;

  // Loading and empty states
  isLoading?: boolean;
  loadingRowCount?: number;
  emptyState?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;

  // Styling
  density?: DensityMode;
  stickyHeader?: boolean;
  className?: string;
  containerClassName?: string;

  // Row interactions
  onRowClick?: (row: TData) => void;
  onRowDoubleClick?: (row: TData) => void;
  getRowId?: (row: TData) => string;

  // Keyboard navigation
  enableKeyboardNavigation?: boolean;
  onRowSelect?: (row: TData) => void;

  // Additional table options
  tableOptions?: Partial<TableOptions<TData>>;
}

// ============================================================================
// Constants
// ============================================================================

const DENSITY_ROW_HEIGHTS: Record<DensityMode, number> = {
  comfortable: 52,
  compact: 40,
};

const DENSITY_PADDING: Record<DensityMode, string> = {
  comfortable: "py-3 px-4",
  compact: "py-2 px-3",
};

// ============================================================================
// Selection Column
// ============================================================================

export function createSelectionColumn<TData>(): ColumnDef<TData> {
  return {
    id: "select",
    size: 40,
    minSize: 40,
    maxSize: 40,
    enableResizing: false,
    enableSorting: false,
    enableHiding: false,
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
        className="translate-y-[2px]"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
        className="translate-y-[2px]"
        onClick={(e) => e.stopPropagation()}
      />
    ),
  };
}

// ============================================================================
// Main Component
// ============================================================================

export function DataTable<TData, TValue>({
  columns,
  data,
  enableRowSelection = false,
  enableMultiRowSelection = true,
  onRowSelectionChange,
  rowSelection: controlledRowSelection,
  enableSorting = true,
  defaultSorting = [],
  onSortingChange,
  enableColumnResizing = true,
  enableColumnReordering = false,
  columnResizeMode = "onChange",
  defaultColumnVisibility = {},
  onColumnVisibilityChange,
  enableVirtualization = true,
  estimateRowHeight,
  overscan = 10,
  isLoading = false,
  loadingRowCount = 10,
  emptyState,
  emptyTitle = "No results found",
  emptyDescription = "Try adjusting your search or filters",
  density = "comfortable",
  stickyHeader = true,
  className,
  containerClassName,
  onRowClick,
  onRowDoubleClick,
  getRowId,
  enableKeyboardNavigation = true,
  onRowSelect,
  tableOptions,
}: DataTableProps<TData, TValue>) {
  // ============================================================================
  // State
  // ============================================================================

  const [sorting, setSorting] = React.useState<SortingState>(defaultSorting);
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>(defaultColumnVisibility);
  const [internalRowSelection, setInternalRowSelection] =
    React.useState<RowSelectionState>({});
  const [columnOrder, setColumnOrder] = React.useState<ColumnOrderState>([]);
  const [columnSizing, setColumnSizing] = React.useState<ColumnSizingState>({});
  const [focusedRowIndex, setFocusedRowIndex] = React.useState<number>(-1);

  const rowSelection = controlledRowSelection ?? internalRowSelection;
  const tableContainerRef = React.useRef<HTMLDivElement>(null);

  // Calculate row height based on density
  const rowHeight = estimateRowHeight ?? DENSITY_ROW_HEIGHTS[density];

  // ============================================================================
  // Prepare columns with selection if enabled
  // ============================================================================

  const finalColumns = React.useMemo(() => {
    if (enableRowSelection) {
      return [createSelectionColumn<TData>(), ...columns];
    }
    return columns;
  }, [columns, enableRowSelection]);

  // ============================================================================
  // Table Instance
  // ============================================================================

  const table = useReactTable({
    data,
    columns: finalColumns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnOrder,
      columnSizing,
    },
    enableRowSelection: enableRowSelection,
    enableMultiRowSelection: enableMultiRowSelection,
    onRowSelectionChange: (updater) => {
      const newSelection =
        typeof updater === "function" ? updater(rowSelection) : updater;
      setInternalRowSelection(newSelection);
      onRowSelectionChange?.(newSelection);
    },
    onSortingChange: (updater) => {
      const newSorting =
        typeof updater === "function" ? updater(sorting) : updater;
      setSorting(newSorting);
      onSortingChange?.(newSorting);
    },
    onColumnVisibilityChange: (updater) => {
      const newVisibility =
        typeof updater === "function" ? updater(columnVisibility) : updater;
      setColumnVisibility(newVisibility);
      onColumnVisibilityChange?.(newVisibility);
    },
    onColumnOrderChange: setColumnOrder,
    onColumnSizingChange: setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: enableSorting ? getSortedRowModel() : undefined,
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: !enableVirtualization
      ? getPaginationRowModel()
      : undefined,
    getRowId: getRowId,
    columnResizeMode: columnResizeMode,
    enableColumnResizing: enableColumnResizing,
    enableSorting: enableSorting,
    ...tableOptions,
  });

  const { rows } = table.getRowModel();

  // ============================================================================
  // Virtualization
  // ============================================================================

  const virtualizer = useVirtualizer({
    count: isLoading ? loadingRowCount : rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => rowHeight,
    overscan: overscan,
    measureElement:
      typeof window !== "undefined" &&
      navigator.userAgent.indexOf("Firefox") === -1
        ? (element) => element?.getBoundingClientRect().height
        : undefined,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  const paddingTop =
    virtualRows.length > 0 ? virtualRows[0]?.start ?? 0 : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0;

  // ============================================================================
  // Keyboard Navigation
  // ============================================================================

  React.useEffect(() => {
    if (!enableKeyboardNavigation) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const container = tableContainerRef.current;
      if (!container?.contains(document.activeElement)) return;

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setFocusedRowIndex((prev) =>
            Math.min(prev + 1, rows.length - 1)
          );
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setFocusedRowIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (focusedRowIndex >= 0 && focusedRowIndex < rows.length) {
            const row = rows[focusedRowIndex];
            onRowSelect?.(row.original);
            onRowClick?.(row.original);
          }
          break;
        case " ":
          if (enableRowSelection && focusedRowIndex >= 0) {
            e.preventDefault();
            const row = rows[focusedRowIndex];
            row.toggleSelected();
          }
          break;
        case "Escape":
          setFocusedRowIndex(-1);
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    enableKeyboardNavigation,
    focusedRowIndex,
    rows,
    enableRowSelection,
    onRowSelect,
    onRowClick,
  ]);

  // Scroll focused row into view
  React.useEffect(() => {
    if (focusedRowIndex >= 0 && enableVirtualization) {
      virtualizer.scrollToIndex(focusedRowIndex, { align: "auto" });
    }
  }, [focusedRowIndex, enableVirtualization, virtualizer]);

  // ============================================================================
  // Render
  // ============================================================================

  const cellPadding = DENSITY_PADDING[density];

  // Empty state
  if (!isLoading && data.length === 0) {
    return (
      <div className={cn("rounded-lg border border-border", className)}>
        {emptyState || (
          <EmptyState
            icon={TableIcon}
            title={emptyTitle}
            description={emptyDescription}
            variant="compact"
          />
        )}
      </div>
    );
  }

  return (
    <div
      className={cn("rounded-lg border border-border overflow-hidden", className)}
    >
      <div
        ref={tableContainerRef}
        className={cn(
          "relative overflow-auto",
          containerClassName
        )}
        style={{ maxHeight: enableVirtualization ? "70vh" : undefined }}
        tabIndex={enableKeyboardNavigation ? 0 : undefined}
      >
        <table
          className="w-full border-collapse text-sm"
          style={{
            width: table.getCenterTotalSize(),
            minWidth: "100%",
          }}
        >
          {/* Header */}
          <thead
            className={cn(
              "bg-background-secondary",
              stickyHeader && "sticky top-0 z-10"
            )}
          >
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-border">
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    colSpan={header.colSpan}
                    className={cn(
                      "group relative text-left font-medium",
                      "text-foreground-secondary text-xs uppercase tracking-wider",
                      cellPadding
                    )}
                    style={{
                      width: header.getSize(),
                      minWidth: header.column.columnDef.minSize,
                      maxWidth: header.column.columnDef.maxSize,
                    }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}

                    {/* Resize handle */}
                    {enableColumnResizing && header.column.getCanResize() && (
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        className={cn(
                          "absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none",
                          "opacity-0 group-hover:opacity-100 bg-border-hover",
                          "transition-opacity",
                          header.column.getIsResizing() && "opacity-100 bg-accent-blue"
                        )}
                      />
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          {/* Body */}
          <tbody className="bg-background">
            {/* Top padding for virtualization */}
            {enableVirtualization && paddingTop > 0 && (
              <tr>
                <td style={{ height: `${paddingTop}px` }} />
              </tr>
            )}

            {/* Loading state */}
            {isLoading ? (
              virtualRows.map((virtualRow) => (
                <tr
                  key={virtualRow.key}
                  className="border-b border-border-subtle"
                  style={{ height: `${virtualRow.size}px` }}
                >
                  {finalColumns.map((column, colIndex) => (
                    <td key={colIndex} className={cellPadding}>
                      <Skeleton
                        className={cn(
                          "h-4",
                          column.id === "select" ? "w-4" : "w-full max-w-[200px]"
                        )}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              // Data rows
              virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                if (!row) return null;

                const isSelected = row.getIsSelected();
                const isFocused = focusedRowIndex === virtualRow.index;

                return (
                  <tr
                    key={row.id}
                    data-index={virtualRow.index}
                    ref={(node) => virtualizer.measureElement(node)}
                    className={cn(
                      "group border-b border-border-subtle transition-colors",
                      "hover:bg-background-tertiary",
                      isSelected && "bg-accent-blue-muted",
                      isFocused && "ring-1 ring-inset ring-accent-blue",
                      (onRowClick || onRowDoubleClick) && "cursor-pointer"
                    )}
                    onClick={() => onRowClick?.(row.original)}
                    onDoubleClick={() => onRowDoubleClick?.(row.original)}
                    data-state={isSelected ? "selected" : undefined}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={cn(
                          cellPadding,
                          "text-foreground"
                        )}
                        style={{
                          width: cell.column.getSize(),
                          minWidth: cell.column.columnDef.minSize,
                          maxWidth: cell.column.columnDef.maxSize,
                        }}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}

            {/* Bottom padding for virtualization */}
            {enableVirtualization && paddingBottom > 0 && (
              <tr>
                <td style={{ height: `${paddingBottom}px` }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Re-export types for convenience
// ============================================================================

export type {
  ColumnDef,
  Row,
  RowSelectionState,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table";
