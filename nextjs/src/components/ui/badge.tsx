import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2.5 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1.5 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-all duration-200 overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        // Status variants with glow effects
        running:
          "border-amber-500/30 bg-amber-500/15 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.15)]",
        completed:
          "border-emerald-500/30 bg-emerald-500/15 text-emerald-400",
        failed:
          "border-red-500/30 bg-red-500/15 text-red-400",
        waiting:
          "border-purple-500/30 bg-purple-500/15 text-purple-400 shadow-[0_0_12px_rgba(168,85,247,0.15)]",
        queued:
          "border-blue-500/30 bg-blue-500/15 text-blue-400",
        timeout:
          "border-orange-500/30 bg-orange-500/15 text-orange-400",
        budgetkilled:
          "border-orange-500/30 bg-orange-500/15 text-orange-400",
        cancelled:
          "border-slate-500/30 bg-slate-500/15 text-slate-400",
        // Risk level variants
        critical:
          "border-red-500/40 bg-red-500/20 text-red-300 font-semibold shadow-[0_0_16px_rgba(239,68,68,0.2)]",
        high:
          "border-orange-500/35 bg-orange-500/18 text-orange-300",
        medium:
          "border-amber-500/30 bg-amber-500/15 text-amber-400",
        low:
          "border-blue-500/25 bg-blue-500/12 text-blue-400",
        // Action variants
        blocked:
          "border-red-500/35 bg-red-500/18 text-red-300",
        logged:
          "border-slate-500/30 bg-slate-500/15 text-slate-400",
        // Type indicators
        llm:
          "border-cyan-500/30 bg-cyan-500/12 text-cyan-400",
        tool:
          "border-violet-500/30 bg-violet-500/12 text-violet-400",
        approval:
          "border-purple-500/30 bg-purple-500/12 text-purple-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  pulse = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean; pulse?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(
        badgeVariants({ variant }),
        pulse && "animate-pulse",
        className
      )}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
