"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Function to format the counter value for display */
type FormatFunction = (value: number) => string;

interface AnimatedCounterProps {
  /** The target value to animate to */
  value: number;
  /** Animation duration in milliseconds (default: 800) */
  duration?: number;
  /** Additional CSS classes */
  className?: string;
  /** Text to prepend to the value */
  prefix?: string;
  /** Text to append to the value */
  suffix?: string;
  /** Custom formatting function */
  formatFn?: FormatFunction;
  /** Number of decimal places (default: 0) */
  decimals?: number;
}

/** Easing function: easeOutExpo for natural deceleration */
function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

/**
 * Animated counter component with smooth number transitions.
 * Uses easeOutExpo for natural deceleration effect.
 */
export function AnimatedCounter({
  value,
  duration = 800,
  className,
  prefix = "",
  suffix = "",
  formatFn,
  decimals = 0,
}: AnimatedCounterProps) {
  // Initialize with the first value to avoid flash
  const [displayValue, setDisplayValue] = useState(value);
  const previousValueRef = useRef(value);
  const animationRef = useRef<number | undefined>(undefined);
  const startTimeRef = useRef<number | undefined>(undefined);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Skip animation on first render - just use the initial value
    if (isFirstRender.current) {
      isFirstRender.current = false;
      previousValueRef.current = value;
      return;
    }

    const startValue = previousValueRef.current;
    const endValue = value;
    const difference = endValue - startValue;

    // Skip animation if values are the same
    if (difference === 0) {
      return;
    }

    const animate = (timestamp: number) => {
      if (!startTimeRef.current) {
        startTimeRef.current = timestamp;
      }

      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeOutExpo(progress);
      const currentValue = startValue + difference * easedProgress;

      setDisplayValue(currentValue);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        previousValueRef.current = endValue;
      }
    };

    // Reset start time for new animation
    startTimeRef.current = undefined;
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [value, duration]);

  const formattedValue = formatFn
    ? formatFn(Math.round(displayValue * Math.pow(10, decimals)) / Math.pow(10, decimals))
    : displayValue.toFixed(decimals);

  return (
    <span className={cn("tabular-nums", className)}>
      {prefix}
      {formattedValue}
      {suffix}
    </span>
  );
}

/**
 * Animated counter with flash effect on value change.
 */
export function AnimatedCounterWithFlash({
  value,
  ...props
}: AnimatedCounterProps) {
  const [isFlashing, setIsFlashing] = useState(false);
  const previousValueRef = useRef(value);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Skip flash on first render
    if (isFirstRender.current) {
      isFirstRender.current = false;
      previousValueRef.current = value;
      return;
    }

    // Only flash when value actually changes
    if (previousValueRef.current !== value) {
      previousValueRef.current = value;
      // Schedule the flash state update via setTimeout to satisfy eslint rule
      const flashTimer = setTimeout(() => setIsFlashing(true), 0);
      const clearTimer = setTimeout(() => setIsFlashing(false), 500);
      return () => {
        clearTimeout(flashTimer);
        clearTimeout(clearTimer);
      };
    }
  }, [value]);

  return (
    <span className={cn(isFlashing && "data-update-flash")}>
      <AnimatedCounter value={value} {...props} />
    </span>
  );
}

/**
 * Compact counter that formats large numbers (1K, 1M, etc.)
 */
export function CompactCounter({
  value,
  className,
  ...props
}: Omit<AnimatedCounterProps, "formatFn">) {
  const formatCompact = (num: number): string => {
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M`;
    }
    if (num >= 1_000) {
      return `${(num / 1_000).toFixed(1)}K`;
    }
    return num.toFixed(0);
  };

  return (
    <AnimatedCounter
      value={value}
      formatFn={formatCompact}
      className={className}
      {...props}
    />
  );
}

/**
 * Cost counter that formats as currency.
 * @param value - Value in cents
 */
export function CostCounter({
  value,
  className,
  ...props
}: Omit<AnimatedCounterProps, "formatFn" | "prefix">) {
  const formatCost = (cents: number): string => {
    if (cents < 100) {
      return `${cents.toFixed(0)}c`;
    }
    const dollars = cents / 100;
    if (dollars >= 1_000) {
      return `$${(dollars / 1_000).toFixed(1)}K`;
    }
    return `$${dollars.toFixed(2)}`;
  };

  return (
    <AnimatedCounter
      value={value}
      formatFn={formatCost}
      className={className}
      {...props}
    />
  );
}

/**
 * Percentage counter with smooth transitions.
 */
export function PercentageCounter({
  value,
  className,
  showSign = false,
  ...props
}: Omit<AnimatedCounterProps, "suffix"> & { showSign?: boolean }) {
  const formatPercent = (num: number): string => {
    const sign = showSign && num > 0 ? "+" : "";
    return `${sign}${num.toFixed(1)}`;
  };

  return (
    <AnimatedCounter
      value={value}
      formatFn={formatPercent}
      suffix="%"
      className={className}
      {...props}
    />
  );
}
