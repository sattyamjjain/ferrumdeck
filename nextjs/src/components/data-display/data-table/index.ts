// Main DataTable component
export {
  DataTable,
  createSelectionColumn,
  type DataTableProps,
  type DensityMode,
} from "./data-table";

// Column header with sorting
export {
  DataTableColumnHeader,
  DataTableDragHandle,
} from "./data-table-column-header";

// Row actions dropdown
export {
  DataTableRowActions,
  type RowAction,
  type RowActionGroup,
} from "./data-table-row-actions";

// Pagination components
export {
  DataTablePagination,
  DataTableCursorPagination,
} from "./data-table-pagination";

// Toolbar with bulk actions
export {
  DataTableToolbar,
  BulkActionIcons,
  type BulkAction,
} from "./data-table-toolbar";

// Hook for advanced table management
export {
  useDataTable,
  type UseDataTableOptions,
} from "./use-data-table";

// Re-export commonly used TanStack Table types
export type {
  ColumnDef,
  Row,
  RowSelectionState,
  SortingState,
  VisibilityState,
  Table,
  PaginationState,
  ColumnFiltersState,
} from "@tanstack/react-table";
