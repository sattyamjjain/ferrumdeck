"use client";

import * as React from "react";
import {
  ColumnDef,
  ColumnFiltersState,
  ColumnOrderState,
  ColumnSizingState,
  PaginationState,
  RowSelectionState,
  SortingState,
  VisibilityState,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type TableOptions,
} from "@tanstack/react-table";

export interface UseDataTableOptions<TData> {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];

  // Pagination
  pageCount?: number;
  initialPagination?: PaginationState;
  onPaginationChange?: (pagination: PaginationState) => void;
  manualPagination?: boolean;

  // Sorting
  initialSorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  manualSorting?: boolean;

  // Filtering
  initialColumnFilters?: ColumnFiltersState;
  onColumnFiltersChange?: (filters: ColumnFiltersState) => void;
  manualFiltering?: boolean;
  globalFilter?: string;
  onGlobalFilterChange?: (filter: string) => void;

  // Selection
  initialRowSelection?: RowSelectionState;
  onRowSelectionChange?: (selection: RowSelectionState) => void;
  enableRowSelection?: boolean | ((row: { original: TData }) => boolean);
  enableMultiRowSelection?: boolean;

  // Column features
  initialColumnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (visibility: VisibilityState) => void;
  initialColumnOrder?: ColumnOrderState;
  onColumnOrderChange?: (order: ColumnOrderState) => void;
  initialColumnSizing?: ColumnSizingState;
  onColumnSizingChange?: (sizing: ColumnSizingState) => void;

  // Row identity
  getRowId?: (row: TData) => string;

  // Additional options
  tableOptions?: Partial<TableOptions<TData>>;
}

export function useDataTable<TData>({
  data,
  columns,
  pageCount,
  initialPagination = { pageIndex: 0, pageSize: 20 },
  onPaginationChange,
  manualPagination = false,
  initialSorting = [],
  onSortingChange,
  manualSorting = false,
  initialColumnFilters = [],
  onColumnFiltersChange,
  manualFiltering = false,
  globalFilter: controlledGlobalFilter,
  onGlobalFilterChange,
  initialRowSelection = {},
  onRowSelectionChange,
  enableRowSelection = false,
  enableMultiRowSelection = true,
  initialColumnVisibility = {},
  onColumnVisibilityChange,
  initialColumnOrder = [],
  onColumnOrderChange,
  initialColumnSizing = {},
  onColumnSizingChange,
  getRowId,
  tableOptions,
}: UseDataTableOptions<TData>) {
  // Internal state
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    initialColumnFilters
  );
  const [internalGlobalFilter, setInternalGlobalFilter] = React.useState("");
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(
    initialColumnVisibility
  );
  const [columnOrder, setColumnOrder] = React.useState<ColumnOrderState>(
    initialColumnOrder
  );
  const [columnSizing, setColumnSizing] = React.useState<ColumnSizingState>(
    initialColumnSizing
  );
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>(
    initialRowSelection
  );
  const [pagination, setPagination] = React.useState<PaginationState>(
    initialPagination
  );

  const globalFilter = controlledGlobalFilter ?? internalGlobalFilter;

  // Create table instance
  const table = useReactTable({
    data,
    columns,
    pageCount: manualPagination ? pageCount : undefined,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      columnVisibility,
      columnOrder,
      columnSizing,
      rowSelection,
      pagination,
    },
    enableRowSelection,
    enableMultiRowSelection,
    manualPagination,
    manualSorting,
    manualFiltering,
    onSortingChange: (updater) => {
      const newSorting =
        typeof updater === "function" ? updater(sorting) : updater;
      setSorting(newSorting);
      onSortingChange?.(newSorting);
    },
    onColumnFiltersChange: (updater) => {
      const newFilters =
        typeof updater === "function" ? updater(columnFilters) : updater;
      setColumnFilters(newFilters);
      onColumnFiltersChange?.(newFilters);
    },
    onGlobalFilterChange: (updater) => {
      const newFilter =
        typeof updater === "function" ? updater(globalFilter) : updater;
      setInternalGlobalFilter(newFilter);
      onGlobalFilterChange?.(newFilter);
    },
    onColumnVisibilityChange: (updater) => {
      const newVisibility =
        typeof updater === "function" ? updater(columnVisibility) : updater;
      setColumnVisibility(newVisibility);
      onColumnVisibilityChange?.(newVisibility);
    },
    onColumnOrderChange: (updater) => {
      const newOrder =
        typeof updater === "function" ? updater(columnOrder) : updater;
      setColumnOrder(newOrder);
      onColumnOrderChange?.(newOrder);
    },
    onColumnSizingChange: (updater) => {
      const newSizing =
        typeof updater === "function" ? updater(columnSizing) : updater;
      setColumnSizing(newSizing);
      onColumnSizingChange?.(newSizing);
    },
    onRowSelectionChange: (updater) => {
      const newSelection =
        typeof updater === "function" ? updater(rowSelection) : updater;
      setRowSelection(newSelection);
      onRowSelectionChange?.(newSelection);
    },
    onPaginationChange: (updater) => {
      const newPagination =
        typeof updater === "function" ? updater(pagination) : updater;
      setPagination(newPagination);
      onPaginationChange?.(newPagination);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: !manualSorting ? getSortedRowModel() : undefined,
    getFilteredRowModel: !manualFiltering ? getFilteredRowModel() : undefined,
    getPaginationRowModel: !manualPagination
      ? getPaginationRowModel()
      : undefined,
    getRowId,
    ...tableOptions,
  });

  // Utility functions
  const selectedRows = React.useMemo(
    () => table.getFilteredSelectedRowModel().rows.map((row) => row.original),
    [table]
  );

  const clearSelection = React.useCallback(() => {
    table.resetRowSelection();
  }, [table]);

  const selectAll = React.useCallback(() => {
    table.toggleAllRowsSelected(true);
  }, [table]);

  return {
    table,
    // State
    sorting,
    columnFilters,
    globalFilter,
    columnVisibility,
    columnOrder,
    columnSizing,
    rowSelection,
    pagination,
    // Computed
    selectedRows,
    selectedCount: selectedRows.length,
    totalCount: table.getFilteredRowModel().rows.length,
    pageCount: table.getPageCount(),
    // Actions
    clearSelection,
    selectAll,
    setGlobalFilter: (filter: string) => {
      setInternalGlobalFilter(filter);
      onGlobalFilterChange?.(filter);
    },
  };
}
