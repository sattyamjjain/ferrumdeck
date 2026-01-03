"use client";

import * as React from "react";
import { Table } from "@tanstack/react-table";
import { X, Columns3, Trash2, Download, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface BulkAction<TData> {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick: (selectedRows: TData[]) => void;
  variant?: "default" | "destructive";
  disabled?: boolean;
}

interface DataTableToolbarProps<TData> {
  table: Table<TData>;
  searchColumn?: string;
  searchPlaceholder?: string;
  bulkActions?: BulkAction<TData>[];
  onRefresh?: () => void;
  isRefreshing?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export function DataTableToolbar<TData>({
  table,
  searchColumn,
  searchPlaceholder = "Search...",
  bulkActions = [],
  onRefresh,
  isRefreshing = false,
  children,
  className,
}: DataTableToolbarProps<TData>) {
  const isFiltered =
    table.getState().columnFilters.length > 0 ||
    table.getState().globalFilter !== "";

  const selectedRows = table.getFilteredSelectedRowModel().rows;
  const hasSelection = selectedRows.length > 0;

  const handleSearch = (value: string) => {
    if (searchColumn) {
      table.getColumn(searchColumn)?.setFilterValue(value);
    } else {
      table.setGlobalFilter(value);
    }
  };

  const getSearchValue = (): string => {
    if (searchColumn) {
      return (table.getColumn(searchColumn)?.getFilterValue() as string) ?? "";
    }
    return table.getState().globalFilter ?? "";
  };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Main toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex flex-1 items-center gap-2">
          {/* Search input */}
          <Input
            placeholder={searchPlaceholder}
            value={getSearchValue()}
            onChange={(event) => handleSearch(event.target.value)}
            className="h-9 w-[200px] lg:w-[280px]"
          />

          {/* Custom filter components */}
          {children}

          {/* Clear filters button */}
          {isFiltered && (
            <Button
              variant="ghost"
              onClick={() => {
                table.resetColumnFilters();
                table.setGlobalFilter("");
              }}
              className="h-9 px-2 lg:px-3"
            >
              Reset
              <X className="ml-2 h-4 w-4" />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Refresh button */}
          {onRefresh && (
            <Button
              variant="outline"
              size="icon-sm"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="h-9 w-9"
            >
              <RefreshCw
                className={cn("h-4 w-4", isRefreshing && "animate-spin")}
              />
              <span className="sr-only">Refresh</span>
            </Button>
          )}

          {/* Column visibility toggle */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                <Columns3 className="mr-2 h-4 w-4" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[180px]">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table
                .getAllColumns()
                .filter(
                  (column) =>
                    typeof column.accessorFn !== "undefined" &&
                    column.getCanHide()
                )
                .map((column) => {
                  return (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      className="capitalize"
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) =>
                        column.toggleVisibility(!!value)
                      }
                    >
                      {column.id.replace(/_/g, " ")}
                    </DropdownMenuCheckboxItem>
                  );
                })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Bulk actions bar */}
      {hasSelection && bulkActions.length > 0 && (
        <BulkActionsBar
          selectedCount={selectedRows.length}
          actions={bulkActions}
          selectedData={selectedRows.map((row) => row.original)}
          onClearSelection={() => table.resetRowSelection()}
        />
      )}
    </div>
  );
}

interface BulkActionsBarProps<TData> {
  selectedCount: number;
  actions: BulkAction<TData>[];
  selectedData: TData[];
  onClearSelection: () => void;
}

function BulkActionsBar<TData>({
  selectedCount,
  actions,
  selectedData,
  onClearSelection,
}: BulkActionsBarProps<TData>) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-accent-blue-muted border border-accent-blue/30 rounded-lg animate-fade-in">
      <span className="text-sm font-medium text-accent-blue">
        {selectedCount} selected
      </span>

      <div className="h-4 w-px bg-accent-blue/30" />

      <div className="flex items-center gap-1">
        {actions.map((action, index) => {
          const Icon = action.icon;
          return (
            <Button
              key={index}
              variant={action.variant === "destructive" ? "destructive" : "ghost"}
              size="sm"
              onClick={() => action.onClick(selectedData)}
              disabled={action.disabled}
              className={cn(
                "h-7 px-2",
                action.variant !== "destructive" &&
                  "hover:bg-accent-blue/20 text-accent-blue"
              )}
            >
              {Icon && <Icon className="mr-1.5 h-3.5 w-3.5" />}
              {action.label}
            </Button>
          );
        })}
      </div>

      <div className="flex-1" />

      <Button
        variant="ghost"
        size="sm"
        onClick={onClearSelection}
        className="h-7 px-2 text-muted-foreground hover:text-foreground"
      >
        Clear selection
        <X className="ml-1 h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// Export icons for common bulk actions
export const BulkActionIcons = {
  Delete: Trash2,
  Export: Download,
  Refresh: RefreshCw,
};
