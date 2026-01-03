"use client";

import { cn } from "@/lib/utils";

interface PageWrapperProps {
  children: React.ReactNode;
  className?: string;
  variant?: "default" | "full" | "compact";
  animate?: boolean;
}

/**
 * Page wrapper with smooth entrance animations
 * Provides consistent page structure and transitions
 */
export function PageWrapper({
  children,
  className,
  variant = "default",
  animate = true,
}: PageWrapperProps) {
  const variantClasses = {
    default: "p-6 md:p-8",
    full: "p-4 md:p-6",
    compact: "p-4",
  };

  return (
    <div
      className={cn(
        "min-h-full",
        animate && "page-enter",
        variantClasses[variant],
        className
      )}
    >
      {children}
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
  badge?: React.ReactNode;
}

/**
 * Page header with title, description and optional actions
 */
export function PageHeader({
  title,
  description,
  children,
  className,
  badge,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6",
        "animate-fade-in",
        className
      )}
    >
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {title}
          </h1>
          {badge}
        </div>
        {description && (
          <p className="text-sm text-foreground-muted">{description}</p>
        )}
      </div>
      {children && (
        <div className="flex items-center gap-3 animate-fade-in" style={{ animationDelay: "0.1s" }}>
          {children}
        </div>
      )}
    </div>
  );
}

interface PageSectionProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  delay?: number;
}

/**
 * Page section with optional title and staggered animation
 */
export function PageSection({
  children,
  className,
  title,
  description,
  actions,
  delay = 0,
}: PageSectionProps) {
  return (
    <section
      className={cn(
        "section-enter",
        className
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      {(title || actions) && (
        <div className="flex items-center justify-between mb-4">
          <div>
            {title && (
              <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            )}
            {description && (
              <p className="text-sm text-foreground-muted mt-0.5">{description}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

interface PageGridProps {
  children: React.ReactNode;
  className?: string;
  columns?: 1 | 2 | 3 | 4;
}

/**
 * Responsive grid layout for page content
 */
export function PageGrid({
  children,
  className,
  columns = 3,
}: PageGridProps) {
  const columnClasses = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  };

  return (
    <div className={cn("grid gap-4", columnClasses[columns], className)}>
      {children}
    </div>
  );
}

interface StaggeredListProps {
  children: React.ReactNode;
  className?: string;
  baseDelay?: number;
  staggerDelay?: number;
}

/**
 * List container that applies staggered entrance animations to children
 */
export function StaggeredList({
  children,
  className,
  baseDelay = 0,
  staggerDelay = 50,
}: StaggeredListProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.isArray(children)
        ? children.map((child, index) => (
            <div
              key={index}
              className="list-enter"
              style={{
                animationDelay: `${baseDelay + index * staggerDelay}ms`,
              }}
            >
              {child}
            </div>
          ))
        : children}
    </div>
  );
}

interface CardGridProps {
  children: React.ReactNode;
  className?: string;
  columns?: 1 | 2 | 3 | 4;
}

/**
 * Card grid with staggered entrance animations
 */
export function CardGrid({
  children,
  className,
  columns = 3,
}: CardGridProps) {
  const columnClasses = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  };

  return (
    <div className={cn("grid gap-4", columnClasses[columns], className)}>
      {Array.isArray(children)
        ? children.map((child, index) => (
            <div
              key={index}
              className="card-enter"
              style={{
                animationDelay: `${index * 50}ms`,
              }}
            >
              {child}
            </div>
          ))
        : children}
    </div>
  );
}
