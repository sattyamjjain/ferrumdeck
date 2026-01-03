"use client";

import { Table } from "@tanstack/react-table";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DataTablePaginationProps<TData> {
  table: Table<TData>;
  pageSizeOptions?: number[];
  showSelectedCount?: boolean;
  showPageInfo?: boolean;
  className?: string;
}

export function DataTablePagination<TData>({
  table,
  pageSizeOptions = [10, 20, 30, 50, 100],
  showSelectedCount = true,
  showPageInfo = true,
  className,
}: DataTablePaginationProps<TData>) {
  const selectedRowCount = table.getFilteredSelectedRowModel().rows.length;
  const totalRowCount = table.getFilteredRowModel().rows.length;

  return (
    <div
      className={cn(
        "flex items-center justify-between px-2 py-4 border-t border-border",
        className
      )}
    >
      <div className="flex items-center gap-4">
        {showSelectedCount && (
          <div className="text-sm text-muted-foreground">
            {selectedRowCount > 0 ? (
              <span className="text-foreground font-medium">
                {selectedRowCount} of {totalRowCount} row(s) selected
              </span>
            ) : (
              <span>{totalRowCount} row(s)</span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-6">
        {/* Rows per page */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Rows per page</span>
          <Select
            value={`${table.getState().pagination.pageSize}`}
            onValueChange={(value) => {
              table.setPageSize(Number(value));
            }}
          >
            <SelectTrigger className="h-8 w-[70px]">
              <SelectValue placeholder={table.getState().pagination.pageSize} />
            </SelectTrigger>
            <SelectContent side="top">
              {pageSizeOptions.map((pageSize) => (
                <SelectItem key={pageSize} value={`${pageSize}`}>
                  {pageSize}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Page info */}
        {showPageInfo && (
          <div className="text-sm text-muted-foreground min-w-[100px] text-center">
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount()}
          </div>
        )}

        {/* Navigation buttons */}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
            className="h-8 w-8"
          >
            <span className="sr-only">Go to first page</span>
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="h-8 w-8"
          >
            <span className="sr-only">Go to previous page</span>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="h-8 w-8"
          >
            <span className="sr-only">Go to next page</span>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
            className="h-8 w-8"
          >
            <span className="sr-only">Go to last page</span>
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// Cursor-based pagination component for API-driven pagination
interface CursorPaginationProps {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  onNextPage: () => void;
  onPreviousPage: () => void;
  isLoading?: boolean;
  totalCount?: number;
  pageSize?: number;
  className?: string;
}

export function DataTableCursorPagination({
  hasNextPage,
  hasPreviousPage,
  onNextPage,
  onPreviousPage,
  isLoading = false,
  totalCount,
  pageSize,
  className,
}: CursorPaginationProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between px-2 py-4 border-t border-border",
        className
      )}
    >
      <div className="text-sm text-muted-foreground">
        {totalCount !== undefined && (
          <span>
            {totalCount} total {totalCount === 1 ? "row" : "rows"}
            {pageSize && ` (showing ${pageSize})`}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onPreviousPage}
          disabled={!hasPreviousPage || isLoading}
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onNextPage}
          disabled={!hasNextPage || isLoading}
        >
          Next
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
