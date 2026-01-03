"use client";

import * as React from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface MultiSelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  color?: "default" | "blue" | "green" | "yellow" | "red" | "purple" | "orange" | "cyan";
}

interface MultiSelectFilterProps<T extends string = string> {
  label: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  options: MultiSelectOption<T>[];
  selected: T[];
  onSelectionChange: (selected: T[]) => void;
  maxDisplayed?: number;
  showSearch?: boolean;
  showSelectAll?: boolean;
  disabled?: boolean;
  className?: string;
}

const colorDots: Record<string, string> = {
  default: "bg-foreground-muted",
  blue: "bg-accent-blue",
  green: "bg-accent-green",
  yellow: "bg-accent-yellow",
  red: "bg-accent-red",
  purple: "bg-accent-purple",
  orange: "bg-accent-orange",
  cyan: "bg-accent-cyan",
};

export function MultiSelectFilter<T extends string = string>({
  label,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyMessage = "No options found.",
  options,
  selected,
  onSelectionChange,
  maxDisplayed = 2,
  showSearch = true,
  showSelectAll = false,
  disabled = false,
  className,
}: MultiSelectFilterProps<T>) {
  const [open, setOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");

  const filteredOptions = React.useMemo(() => {
    if (!searchQuery) return options;
    const query = searchQuery.toLowerCase();
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(query) ||
        option.description?.toLowerCase().includes(query)
    );
  }, [options, searchQuery]);

  const selectedOptions = React.useMemo(
    () => options.filter((opt) => selected.includes(opt.value)),
    [options, selected]
  );

  const handleSelect = (value: T) => {
    if (selected.includes(value)) {
      onSelectionChange(selected.filter((v) => v !== value));
    } else {
      onSelectionChange([...selected, value]);
    }
  };

  const handleSelectAll = () => {
    if (selected.length === options.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(options.map((opt) => opt.value));
    }
  };

  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectionChange([]);
  };

  const renderTriggerContent = () => {
    if (selected.length === 0) {
      return (
        <span className="text-muted-foreground font-normal">{placeholder}</span>
      );
    }

    if (selected.length <= maxDisplayed) {
      return (
        <div className="flex items-center gap-1 flex-wrap">
          {selectedOptions.map((option) => (
            <Badge
              key={option.value}
              variant="secondary"
              className="text-xs h-5 px-1.5 bg-background-tertiary border-border/30"
            >
              {option.color && (
                <span
                  className={cn("h-1.5 w-1.5 rounded-full mr-1", colorDots[option.color])}
                />
              )}
              {option.label}
            </Badge>
          ))}
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1">
        <Badge
          variant="secondary"
          className="text-xs h-5 px-1.5 bg-background-tertiary border-border/30"
        >
          {selected.length} selected
        </Badge>
      </div>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-9 min-w-[140px] justify-between gap-2",
            "bg-background-secondary border-border/50",
            "hover:bg-background-tertiary hover:border-border",
            "data-[state=open]:border-accent-blue/50 data-[state=open]:bg-background",
            className
          )}
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <span className="text-muted-foreground">{label}</span>
            {renderTriggerContent()}
          </span>
          <div className="flex items-center gap-1">
            {selected.length > 0 && (
              <button
                onClick={handleClearAll}
                className="p-0.5 rounded-sm hover:bg-foreground/10 transition-colors"
                aria-label="Clear selection"
              >
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0" align="start">
        <Command shouldFilter={false}>
          {showSearch && (
            <div className="flex items-center border-b px-3 py-2">
              <Search className="h-4 w-4 text-muted-foreground mr-2" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="p-0.5 rounded-sm hover:bg-foreground/10"
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              )}
            </div>
          )}
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            {showSelectAll && filteredOptions.length > 0 && (
              <>
                <CommandGroup>
                  <CommandItem
                    onSelect={handleSelectAll}
                    className="cursor-pointer"
                  >
                    <div
                      className={cn(
                        "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border",
                        selected.length === options.length
                          ? "bg-primary border-primary text-primary-foreground"
                          : selected.length > 0
                          ? "bg-primary/50 border-primary"
                          : "border-input"
                      )}
                    >
                      {selected.length === options.length && (
                        <Check className="h-3 w-3" />
                      )}
                      {selected.length > 0 && selected.length < options.length && (
                        <div className="h-2 w-2 bg-primary-foreground rounded-sm" />
                      )}
                    </div>
                    <span className="font-medium">
                      {selected.length === options.length
                        ? "Deselect all"
                        : "Select all"}
                    </span>
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            <ScrollArea className="max-h-[200px]">
              <CommandGroup>
                {filteredOptions.map((option) => {
                  const isSelected = selected.includes(option.value);
                  return (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      onSelect={() => handleSelect(option.value)}
                      className="cursor-pointer"
                    >
                      <div
                        className={cn(
                          "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border transition-colors",
                          isSelected
                            ? "bg-primary border-primary text-primary-foreground"
                            : "border-input"
                        )}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </div>
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {option.icon && (
                          <span className="shrink-0">{option.icon}</span>
                        )}
                        {option.color && !option.icon && (
                          <span
                            className={cn(
                              "h-2 w-2 rounded-full shrink-0",
                              colorDots[option.color]
                            )}
                          />
                        )}
                        <div className="flex flex-col min-w-0">
                          <span className="truncate">{option.label}</span>
                          {option.description && (
                            <span className="text-xs text-muted-foreground truncate">
                              {option.description}
                            </span>
                          )}
                        </div>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </ScrollArea>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
