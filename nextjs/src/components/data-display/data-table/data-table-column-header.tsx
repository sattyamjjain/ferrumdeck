"use client";

import { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, EyeOff, GripVertical } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DataTableColumnHeaderProps<TData, TValue>
  extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>;
  title: string;
  enableSorting?: boolean;
  enableHiding?: boolean;
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
  enableSorting = true,
  enableHiding = true,
}: DataTableColumnHeaderProps<TData, TValue>) {
  const canSort = column.getCanSort() && enableSorting;
  const canHide = column.getCanHide() && enableHiding;

  if (!canSort && !canHide) {
    return (
      <div className={cn("flex items-center space-x-2", className)}>
        <span className="text-foreground-secondary font-medium text-xs uppercase tracking-wider">
          {title}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center space-x-2", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "-ml-3 h-8 data-[state=open]:bg-accent",
              "hover:bg-background-tertiary focus-visible:ring-0"
            )}
          >
            <span className="text-foreground-secondary font-medium text-xs uppercase tracking-wider">
              {title}
            </span>
            {column.getIsSorted() === "desc" ? (
              <ArrowDown className="ml-2 h-3.5 w-3.5 text-accent-blue" />
            ) : column.getIsSorted() === "asc" ? (
              <ArrowUp className="ml-2 h-3.5 w-3.5 text-accent-blue" />
            ) : (
              canSort && (
                <ArrowUpDown className="ml-2 h-3.5 w-3.5 text-muted-foreground" />
              )
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[140px]">
          {canSort && (
            <>
              <DropdownMenuItem onClick={() => column.toggleSorting(false)}>
                <ArrowUp className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                Asc
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => column.toggleSorting(true)}>
                <ArrowDown className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                Desc
              </DropdownMenuItem>
              {column.getIsSorted() && (
                <DropdownMenuItem onClick={() => column.clearSorting()}>
                  <ArrowUpDown className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                  Clear
                </DropdownMenuItem>
              )}
            </>
          )}
          {canSort && canHide && <DropdownMenuSeparator />}
          {canHide && (
            <DropdownMenuItem onClick={() => column.toggleVisibility(false)}>
              <EyeOff className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
              Hide
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// Drag handle for column reordering
export function DataTableDragHandle() {
  return (
    <div className="cursor-grab active:cursor-grabbing">
      <GripVertical className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}
