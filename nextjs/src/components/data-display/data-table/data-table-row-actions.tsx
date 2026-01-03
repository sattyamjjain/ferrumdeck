"use client";

import * as React from "react";
import { Row } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";

export interface RowAction<TData> {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick: (row: TData) => void;
  variant?: "default" | "destructive";
  shortcut?: string;
  disabled?: boolean | ((row: TData) => boolean);
  hidden?: boolean | ((row: TData) => boolean);
}

export interface RowActionGroup<TData> {
  label?: string;
  actions: RowAction<TData>[];
}

interface DataTableRowActionsProps<TData> {
  row: Row<TData>;
  actions: (RowAction<TData> | RowActionGroup<TData>)[];
  className?: string;
}

function isActionGroup<TData>(
  item: RowAction<TData> | RowActionGroup<TData>
): item is RowActionGroup<TData> {
  return "actions" in item;
}

export function DataTableRowActions<TData>({
  row,
  actions,
  className,
}: DataTableRowActionsProps<TData>) {
  const data = row.original;

  // Filter out hidden actions
  const visibleActions = actions.filter((item) => {
    if (isActionGroup(item)) {
      return item.actions.some((action) => {
        const hidden =
          typeof action.hidden === "function"
            ? action.hidden(data)
            : action.hidden;
        return !hidden;
      });
    }
    const hidden =
      typeof item.hidden === "function" ? item.hidden(data) : item.hidden;
    return !hidden;
  });

  if (visibleActions.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(
            "h-8 w-8 p-0 data-[state=open]:bg-muted",
            "opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100",
            "transition-opacity",
            className
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {visibleActions.map((item, index) => {
          if (isActionGroup(item)) {
            const groupActions = item.actions.filter((action) => {
              const hidden =
                typeof action.hidden === "function"
                  ? action.hidden(data)
                  : action.hidden;
              return !hidden;
            });

            if (groupActions.length === 0) return null;

            return (
              <React.Fragment key={`group-${index}`}>
                {index > 0 && <DropdownMenuSeparator />}
                {item.label && (
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    {item.label}
                  </DropdownMenuLabel>
                )}
                {groupActions.map((action, actionIndex) => (
                  <ActionMenuItem
                    key={`action-${actionIndex}`}
                    action={action}
                    data={data}
                  />
                ))}
              </React.Fragment>
            );
          }

          return (
            <React.Fragment key={`action-${index}`}>
              {index > 0 && <DropdownMenuSeparator />}
              <ActionMenuItem action={item} data={data} />
            </React.Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ActionMenuItem<TData>({
  action,
  data,
}: {
  action: RowAction<TData>;
  data: TData;
}) {
  const disabled =
    typeof action.disabled === "function"
      ? action.disabled(data)
      : action.disabled;

  const Icon = action.icon;

  return (
    <DropdownMenuItem
      onClick={() => action.onClick(data)}
      disabled={disabled}
      variant={action.variant}
      className="cursor-pointer"
    >
      {Icon && <Icon className="mr-2 h-4 w-4" />}
      {action.label}
      {action.shortcut && (
        <DropdownMenuShortcut>{action.shortcut}</DropdownMenuShortcut>
      )}
    </DropdownMenuItem>
  );
}
