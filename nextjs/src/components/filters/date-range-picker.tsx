"use client";

import * as React from "react";
import { Calendar, ChevronDown, X } from "lucide-react";
import {
  format,
  subDays,
  subHours,
  subWeeks,
  subMonths,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  isValid,
  parse,
} from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

export interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

export interface DatePreset {
  label: string;
  getValue: () => DateRange;
}

const defaultPresets: DatePreset[] = [
  {
    label: "Last hour",
    getValue: () => ({
      from: subHours(new Date(), 1),
      to: new Date(),
    }),
  },
  {
    label: "Last 24 hours",
    getValue: () => ({
      from: subDays(new Date(), 1),
      to: new Date(),
    }),
  },
  {
    label: "Last 7 days",
    getValue: () => ({
      from: subWeeks(new Date(), 1),
      to: new Date(),
    }),
  },
  {
    label: "Last 30 days",
    getValue: () => ({
      from: subMonths(new Date(), 1),
      to: new Date(),
    }),
  },
  {
    label: "This week",
    getValue: () => ({
      from: startOfWeek(new Date(), { weekStartsOn: 1 }),
      to: endOfWeek(new Date(), { weekStartsOn: 1 }),
    }),
  },
  {
    label: "This month",
    getValue: () => ({
      from: startOfMonth(new Date()),
      to: endOfMonth(new Date()),
    }),
  },
  {
    label: "Today",
    getValue: () => ({
      from: startOfDay(new Date()),
      to: endOfDay(new Date()),
    }),
  },
];

interface DateRangePickerProps {
  label?: string;
  placeholder?: string;
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  presets?: DatePreset[];
  showPresets?: boolean;
  disabled?: boolean;
  className?: string;
}

export function DateRangePicker({
  label = "Date",
  placeholder = "Select date range...",
  value,
  onChange,
  presets = defaultPresets,
  showPresets = true,
  disabled = false,
  className,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [fromInput, setFromInput] = React.useState("");
  const [toInput, setToInput] = React.useState("");
  const [activePreset, setActivePreset] = React.useState<string | null>(null);

  // Sync input values with external value
  React.useEffect(() => {
    if (value?.from) {
      setFromInput(format(value.from, "yyyy-MM-dd"));
    } else {
      setFromInput("");
    }
    if (value?.to) {
      setToInput(format(value.to, "yyyy-MM-dd"));
    } else {
      setToInput("");
    }
  }, [value]);

  const handleFromChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    setFromInput(inputValue);
    setActivePreset(null);

    if (inputValue === "") {
      onChange({ from: undefined, to: value?.to });
      return;
    }

    const parsed = parse(inputValue, "yyyy-MM-dd", new Date());
    if (isValid(parsed)) {
      onChange({ from: startOfDay(parsed), to: value?.to });
    }
  };

  const handleToChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    setToInput(inputValue);
    setActivePreset(null);

    if (inputValue === "") {
      onChange({ from: value?.from, to: undefined });
      return;
    }

    const parsed = parse(inputValue, "yyyy-MM-dd", new Date());
    if (isValid(parsed)) {
      onChange({ from: value?.from, to: endOfDay(parsed) });
    }
  };

  const handlePresetSelect = (preset: DatePreset) => {
    const range = preset.getValue();
    onChange(range);
    setActivePreset(preset.label);
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(undefined);
    setActivePreset(null);
  };

  const formatDisplayValue = () => {
    if (activePreset && value?.from && value?.to) {
      return activePreset;
    }

    if (value?.from && value?.to) {
      return `${format(value.from, "MMM d")} - ${format(value.to, "MMM d, yyyy")}`;
    }

    if (value?.from) {
      return `From ${format(value.from, "MMM d, yyyy")}`;
    }

    if (value?.to) {
      return `Until ${format(value.to, "MMM d, yyyy")}`;
    }

    return null;
  };

  const displayValue = formatDisplayValue();
  const hasValue = value?.from || value?.to;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-9 min-w-[160px] justify-between gap-2",
            "bg-background-secondary border-border/50",
            "hover:bg-background-tertiary hover:border-border",
            "data-[state=open]:border-accent-blue/50 data-[state=open]:bg-background",
            className
          )}
        >
          <span className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground font-medium">{label}</span>
            {displayValue ? (
              <span className="font-medium text-foreground">{displayValue}</span>
            ) : (
              <span className="font-normal text-muted-foreground">
                {placeholder}
              </span>
            )}
          </span>
          <div className="flex items-center gap-1">
            {hasValue && (
              <button
                onClick={handleClear}
                className="p-0.5 rounded-sm hover:bg-foreground/10 transition-colors"
                aria-label="Clear date range"
              >
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <div className="p-3 space-y-3">
          {/* Custom date inputs */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              Custom range
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Input
                  type="date"
                  value={fromInput}
                  onChange={handleFromChange}
                  placeholder="From"
                  className="h-8 text-sm bg-background-secondary"
                />
              </div>
              <span className="text-muted-foreground text-sm">to</span>
              <div className="flex-1">
                <Input
                  type="date"
                  value={toInput}
                  onChange={handleToChange}
                  placeholder="To"
                  className="h-8 text-sm bg-background-secondary"
                />
              </div>
            </div>
          </div>

          {/* Presets */}
          {showPresets && presets.length > 0 && (
            <>
              <div className="border-t border-border" />
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Quick select
                </label>
                <div className="grid grid-cols-2 gap-1">
                  {presets.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => handlePresetSelect(preset)}
                      className={cn(
                        "px-2 py-1.5 text-xs rounded-md text-left transition-colors",
                        activePreset === preset.label
                          ? "bg-accent-blue/15 text-accent-blue border border-accent-blue/30"
                          : "hover:bg-background-tertiary text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Utility to convert DateRange to URL-safe strings
export function dateRangeToParams(
  range: DateRange | undefined
): { from?: string; to?: string } {
  if (!range) return {};
  return {
    from: range.from ? range.from.toISOString() : undefined,
    to: range.to ? range.to.toISOString() : undefined,
  };
}

// Utility to parse URL params back to DateRange
export function paramsToDateRange(params: {
  from?: string | null;
  to?: string | null;
}): DateRange | undefined {
  const from = params.from ? new Date(params.from) : undefined;
  const to = params.to ? new Date(params.to) : undefined;

  if (!from && !to) return undefined;

  return {
    from: from && isValid(from) ? from : undefined,
    to: to && isValid(to) ? to : undefined,
  };
}
