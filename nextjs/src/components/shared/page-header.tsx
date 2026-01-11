"use client";

import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";

type ColorTheme =
  | "blue"
  | "green"
  | "red"
  | "yellow"
  | "purple"
  | "orange"
  | "cyan"
  | "slate";

interface PageHeaderProps {
  title: string;
  description?: string;
  icon: LucideIcon;
  colorTheme?: ColorTheme;
  children?: ReactNode;
  className?: string;
}

const themeConfig: Record<
  ColorTheme,
  {
    gradient: string;
    iconBg: string;
    iconBorder: string;
    iconColor: string;
  }
> = {
  blue: {
    gradient: "from-blue-500/8 via-blue-500/3 to-transparent",
    iconBg: "bg-blue-500/10",
    iconBorder: "border-blue-500/20",
    iconColor: "text-blue-400",
  },
  green: {
    gradient: "from-emerald-500/8 via-emerald-500/3 to-transparent",
    iconBg: "bg-emerald-500/10",
    iconBorder: "border-emerald-500/20",
    iconColor: "text-emerald-400",
  },
  red: {
    gradient: "from-red-500/8 via-red-500/3 to-transparent",
    iconBg: "bg-red-500/10",
    iconBorder: "border-red-500/20",
    iconColor: "text-red-400",
  },
  yellow: {
    gradient: "from-amber-500/8 via-amber-500/3 to-transparent",
    iconBg: "bg-amber-500/10",
    iconBorder: "border-amber-500/20",
    iconColor: "text-amber-400",
  },
  purple: {
    gradient: "from-purple-500/8 via-purple-500/3 to-transparent",
    iconBg: "bg-purple-500/10",
    iconBorder: "border-purple-500/20",
    iconColor: "text-purple-400",
  },
  orange: {
    gradient: "from-orange-500/8 via-orange-500/3 to-transparent",
    iconBg: "bg-orange-500/10",
    iconBorder: "border-orange-500/20",
    iconColor: "text-orange-400",
  },
  cyan: {
    gradient: "from-cyan-500/8 via-cyan-500/3 to-transparent",
    iconBg: "bg-cyan-500/10",
    iconBorder: "border-cyan-500/20",
    iconColor: "text-cyan-400",
  },
  slate: {
    gradient: "from-slate-500/8 via-slate-500/3 to-transparent",
    iconBg: "bg-slate-500/10",
    iconBorder: "border-slate-500/20",
    iconColor: "text-slate-400",
  },
};

export function PageHeader({
  title,
  description,
  icon: Icon,
  colorTheme = "blue",
  children,
  className,
}: PageHeaderProps) {
  const theme = themeConfig[colorTheme];

  return (
    <div className={cn("relative", className)}>
      {/* Background gradient */}
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-r rounded-xl -z-10",
          theme.gradient
        )}
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 pb-2">
          {/* Icon container with glow effect */}
          <div className="relative group">
            {/* Glow effect on hover */}
            <div
              className={cn(
                "absolute inset-0 rounded-xl blur-md opacity-0 group-hover:opacity-60 transition-opacity duration-300",
                theme.iconBg
              )}
            />
            <div
              className={cn(
                "relative p-2.5 rounded-xl border transition-all duration-200",
                "group-hover:scale-105",
                theme.iconBg,
                theme.iconBorder
              )}
            >
              <Icon className={cn("h-5 w-5", theme.iconColor)} />
            </div>
          </div>

          {/* Title and description */}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {description}
              </p>
            )}
          </div>
        </div>

        {/* Actions slot */}
        {children && <div className="flex items-center gap-2">{children}</div>}
      </div>
    </div>
  );
}
