"use client";

import * as React from "react";
import { Search, SlidersHorizontal, X, ChevronDown, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { FilterChip, FilterChipsContainer } from "./filter-chip";
import { MultiSelectFilter, type MultiSelectOption } from "./multi-select-filter";
import { DateRangePicker, type DateRange } from "./date-range-picker";
import { SavedViews, SavedViewChips, type SavedView } from "./saved-views";

// ============================================================================
// Filter Configuration Types
// ============================================================================

export type FilterType = "text" | "multi-select" | "date-range" | "single-select";

interface BaseFilterConfig<T extends string = string> {
  id: T;
  label: string;
  type: FilterType;
  placeholder?: string;
}

export interface TextFilterConfig<T extends string = string> extends BaseFilterConfig<T> {
  type: "text";
}

export interface MultiSelectFilterConfig<T extends string = string, V extends string = string>
  extends BaseFilterConfig<T> {
  type: "multi-select";
  options: MultiSelectOption<V>[];
  showSearch?: boolean;
  showSelectAll?: boolean;
}

export interface DateRangeFilterConfig<T extends string = string> extends BaseFilterConfig<T> {
  type: "date-range";
  showPresets?: boolean;
}

export interface SingleSelectFilterConfig<T extends string = string, V extends string = string>
  extends BaseFilterConfig<T> {
  type: "single-select";
  options: { value: V; label: string }[];
  defaultValue?: V;
}

export type FilterConfig<T extends string = string> =
  | TextFilterConfig<T>
  | MultiSelectFilterConfig<T>
  | DateRangeFilterConfig<T>
  | SingleSelectFilterConfig<T>;

// ============================================================================
// Filter Values Type
// ============================================================================

export type FilterValues<T extends FilterConfig[]> = {
  [K in T[number]["id"]]?: T[number] extends { id: K; type: "text" }
    ? string
    : T[number] extends { id: K; type: "multi-select" }
    ? string[]
    : T[number] extends { id: K; type: "date-range" }
    ? DateRange
    : T[number] extends { id: K; type: "single-select" }
    ? string
    : unknown;
};

// ============================================================================
// FilterBar Props
// ============================================================================

interface FilterBarProps<TFilters extends FilterConfig[] = FilterConfig[]> {
  // Core filter configuration
  filters: TFilters;
  values: FilterValues<TFilters>;
  onChange: (values: FilterValues<TFilters>) => void;

  // Search configuration
  searchPlaceholder?: string;
  searchKey?: string;

  // Saved views configuration
  savedViews?: SavedView<FilterValues<TFilters>>[];
  activeViewId?: string | null;
  onViewSelect?: (view: SavedView<FilterValues<TFilters>>) => void;
  onViewCreate?: (name: string, filters: FilterValues<TFilters>) => void;
  onViewUpdate?: (id: string, name: string) => void;
  onViewDelete?: (id: string) => void;
  onSetDefaultView?: (id: string) => void;
  showSavedViewChips?: boolean;

  // Display options
  showActiveFilters?: boolean;
  compactMode?: boolean;
  className?: string;
}

// ============================================================================
// FilterBar Component
// ============================================================================

export function FilterBar<TFilters extends FilterConfig[] = FilterConfig[]>({
  filters,
  values,
  onChange,
  searchPlaceholder = "Search...",
  searchKey = "search",
  savedViews = [],
  activeViewId,
  onViewSelect,
  onViewCreate,
  onViewUpdate,
  onViewDelete,
  onSetDefaultView,
  showSavedViewChips = true,
  showActiveFilters = true,
  compactMode = false,
  className,
}: FilterBarProps<TFilters>) {
  const [moreFiltersOpen, setMoreFiltersOpen] = React.useState(false);

  // Find the text filter for search
  const searchFilter = filters.find(
    (f): f is TextFilterConfig => f.type === "text" && f.id === searchKey
  );

  // Separate primary filters from overflow
  const primaryFilters = filters.filter(
    (f) => f.type !== "text" || f.id !== searchKey
  );

  // Get the search value
  const searchValue = (values as Record<string, unknown>)[searchKey] as string | undefined;

  // Calculate active filter count
  const activeFilterCount = React.useMemo(() => {
    let count = 0;
    for (const filter of filters) {
      const value = (values as Record<string, unknown>)[filter.id];
      if (filter.type === "text" && value) count++;
      if (filter.type === "multi-select" && Array.isArray(value) && value.length > 0) count++;
      if (filter.type === "date-range" && value && (value as DateRange).from) count++;
      if (filter.type === "single-select" && value) count++;
    }
    return count;
  }, [filters, values]);

  // Check if there are any active filters
  const hasActiveFilters = activeFilterCount > 0;

  // Check if current filters differ from active view
  const hasUnsavedChanges = React.useMemo(() => {
    if (!activeViewId) return false;
    const activeView = savedViews.find((v) => v.id === activeViewId);
    if (!activeView) return false;
    return JSON.stringify(values) !== JSON.stringify(activeView.filters);
  }, [activeViewId, savedViews, values]);

  // Handle clearing all filters
  const handleClearAll = () => {
    const cleared: Record<string, unknown> = {};
    for (const filter of filters) {
      if (filter.type === "single-select" && filter.defaultValue) {
        cleared[filter.id] = filter.defaultValue;
      }
    }
    onChange(cleared as FilterValues<TFilters>);
  };

  // Handle individual filter changes
  const handleFilterChange = (filterId: string, value: unknown) => {
    onChange({
      ...values,
      [filterId]: value,
    } as FilterValues<TFilters>);
  };

  // Handle search change
  const handleSearchChange = (value: string) => {
    handleFilterChange(searchKey, value || undefined);
  };

  // Render a filter based on its type
  const renderFilter = (config: FilterConfig) => {
    const value = (values as Record<string, unknown>)[config.id];

    switch (config.type) {
      case "multi-select":
        return (
          <MultiSelectFilter
            key={config.id}
            label={config.label}
            placeholder={config.placeholder}
            options={config.options}
            selected={(value as string[]) || []}
            onSelectionChange={(selected) => handleFilterChange(config.id, selected)}
            showSearch={config.showSearch}
            showSelectAll={config.showSelectAll}
          />
        );

      case "date-range":
        return (
          <DateRangePicker
            key={config.id}
            label={config.label}
            placeholder={config.placeholder}
            value={value as DateRange | undefined}
            onChange={(range) => handleFilterChange(config.id, range)}
            showPresets={config.showPresets}
          />
        );

      case "single-select":
        return (
          <SingleSelectDropdown
            key={config.id}
            label={config.label}
            placeholder={config.placeholder}
            options={config.options}
            value={(value as string) || config.defaultValue}
            onChange={(val) => handleFilterChange(config.id, val)}
          />
        );

      default:
        return null;
    }
  };

  // Render active filter chips
  const renderActiveFilterChips = () => {
    const chips: React.ReactNode[] = [];

    for (const filter of filters) {
      const value = (values as Record<string, unknown>)[filter.id];

      if (filter.type === "text" && value) {
        chips.push(
          <FilterChip
            key={filter.id}
            label={filter.label}
            value={String(value).length > 20 ? `${String(value).slice(0, 20)}...` : String(value)}
            onRemove={() => handleFilterChange(filter.id, undefined)}
          />
        );
      }

      if (filter.type === "multi-select" && Array.isArray(value) && value.length > 0) {
        const selectedLabels = (filter as MultiSelectFilterConfig).options
          .filter((opt) => value.includes(opt.value))
          .map((opt) => opt.label);

        chips.push(
          <FilterChip
            key={filter.id}
            label={filter.label}
            value={
              selectedLabels.length > 2
                ? `${selectedLabels.length} selected`
                : selectedLabels.join(", ")
            }
            onRemove={() => handleFilterChange(filter.id, [])}
          />
        );
      }

      if (filter.type === "date-range" && value) {
        const range = value as DateRange;
        if (range.from || range.to) {
          chips.push(
            <FilterChip
              key={filter.id}
              label={filter.label}
              value={
                range.from && range.to
                  ? `${formatShortDate(range.from)} - ${formatShortDate(range.to)}`
                  : range.from
                  ? `From ${formatShortDate(range.from)}`
                  : `Until ${formatShortDate(range.to!)}`
              }
              onRemove={() => handleFilterChange(filter.id, undefined)}
            />
          );
        }
      }

      if (filter.type === "single-select" && value && value !== (filter as SingleSelectFilterConfig).defaultValue) {
        const option = (filter as SingleSelectFilterConfig).options.find(
          (opt) => opt.value === value
        );
        if (option) {
          chips.push(
            <FilterChip
              key={filter.id}
              label={filter.label}
              value={option.label}
              onRemove={() =>
                handleFilterChange(filter.id, (filter as SingleSelectFilterConfig).defaultValue)
              }
            />
          );
        }
      }
    }

    return chips;
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* Main filter row */}
      <div
        className={cn(
          "flex flex-col gap-3",
          compactMode ? "sm:flex-row sm:items-center" : "lg:flex-row lg:items-center"
        )}
      >
        {/* Search input */}
        {searchFilter && (
          <div className="relative flex-1 max-w-md group">
            <Search
              className={cn(
                "absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors",
                "group-focus-within:text-accent-blue"
              )}
            />
            <Input
              placeholder={searchPlaceholder}
              value={searchValue || ""}
              onChange={(e) => handleSearchChange(e.target.value)}
              className={cn(
                "pl-10 pr-10 h-9",
                "bg-background-secondary border-border/50",
                "placeholder:text-muted-foreground/50",
                "focus:border-accent-blue/50 focus:bg-background",
                "transition-all duration-200"
              )}
            />
            {searchValue && (
              <button
                onClick={() => handleSearchChange("")}
                className={cn(
                  "absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-sm",
                  "text-muted-foreground hover:text-foreground",
                  "hover:bg-background-tertiary transition-colors"
                )}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Filter dropdowns */}
        <div className="flex items-center gap-2 flex-wrap">
          {primaryFilters.slice(0, compactMode ? 2 : 4).map(renderFilter)}

          {/* More filters button (if needed) */}
          {primaryFilters.length > (compactMode ? 2 : 4) && (
            <Popover open={moreFiltersOpen} onOpenChange={setMoreFiltersOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-9 gap-2",
                    "bg-background-secondary border-border/50",
                    "hover:bg-background-tertiary hover:border-border"
                  )}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  More filters
                  {activeFilterCount > 0 && (
                    <Badge
                      variant="secondary"
                      className="h-5 px-1.5 text-xs bg-accent-blue/15 text-accent-blue border-accent-blue/30"
                    >
                      {activeFilterCount}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[320px] p-3" align="end">
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">Additional filters</h4>
                  <div className="space-y-2">
                    {primaryFilters.slice(compactMode ? 2 : 4).map((config) => (
                      <div key={config.id} className="flex flex-col gap-1">
                        <label className="text-xs text-muted-foreground">
                          {config.label}
                        </label>
                        {renderFilter(config)}
                      </div>
                    ))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}

          {/* Saved views dropdown */}
          {(onViewCreate || savedViews.length > 0) && (
            <SavedViews
              views={savedViews}
              activeViewId={activeViewId}
              currentFilters={values}
              onViewSelect={onViewSelect || (() => {})}
              onViewCreate={onViewCreate || (() => {})}
              onViewUpdate={onViewUpdate || (() => {})}
              onViewDelete={onViewDelete || (() => {})}
              onSetDefault={onSetDefaultView}
              hasUnsavedChanges={hasUnsavedChanges}
            />
          )}
        </div>
      </div>

      {/* Saved view chips */}
      {showSavedViewChips && savedViews.length > 0 && onViewSelect && (
        <SavedViewChips
          views={savedViews}
          activeViewId={activeViewId}
          onViewSelect={onViewSelect}
        />
      )}

      {/* Active filters */}
      {showActiveFilters && hasActiveFilters && (
        <FilterChipsContainer onClearAll={handleClearAll}>
          {renderActiveFilterChips()}
        </FilterChipsContainer>
      )}
    </div>
  );
}

// ============================================================================
// SingleSelectDropdown Component
// ============================================================================

interface SingleSelectDropdownProps<T extends string = string> {
  label: string;
  placeholder?: string;
  options: { value: T; label: string }[];
  value?: T;
  onChange: (value: T) => void;
  className?: string;
}

function SingleSelectDropdown<T extends string = string>({
  label,
  placeholder = "Select...",
  options,
  value,
  onChange,
  className,
}: SingleSelectDropdownProps<T>) {
  const [open, setOpen] = React.useState(false);
  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-9 min-w-[120px] justify-between gap-2",
            "bg-background-secondary border-border/50",
            "hover:bg-background-tertiary hover:border-border",
            "data-[state=open]:border-accent-blue/50 data-[state=open]:bg-background",
            className
          )}
        >
          <span className="flex items-center gap-2 text-sm">
            <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground font-medium">{label}</span>
            {selectedOption ? (
              <span className="font-medium">{selectedOption.label}</span>
            ) : (
              <span className="font-normal text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[180px] p-1" align="start">
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => {
              onChange(option.value);
              setOpen(false);
            }}
            className={cn(
              "w-full flex items-center px-2 py-1.5 rounded-sm text-sm text-left transition-colors",
              value === option.value
                ? "bg-accent-blue/10 text-accent-blue"
                : "hover:bg-background-tertiary"
            )}
          >
            {option.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// ============================================================================
// Utility Functions
// ============================================================================

function formatShortDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ============================================================================
// Type Helpers
// ============================================================================

// Helper type to extract filter value type from config
export type ExtractFilterValue<T extends FilterConfig> = T extends TextFilterConfig
  ? string | undefined
  : T extends MultiSelectFilterConfig<string, infer V>
  ? V[] | undefined
  : T extends DateRangeFilterConfig
  ? DateRange | undefined
  : T extends SingleSelectFilterConfig<string, infer V>
  ? V | undefined
  : never;
