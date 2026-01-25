"use client";

import { useEffect } from "react";
import { AlertOctagon, RefreshCcw, Home, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import Link from "next/link";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function DashboardError({ error, reset }: ErrorPageProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Log error to error reporting service in production
    console.error("Dashboard error:", error);
  }, [error]);

  const copyErrorId = async () => {
    if (error.digest) {
      await navigator.clipboard.writeText(error.digest);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 bg-gradient-mesh opacity-40" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-gradient-to-b from-accent-red/15 via-accent-orange/5 to-transparent blur-3xl" />

      {/* Animated warning stripes */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute inset-0" style={{
          backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, var(--accent-red) 10px, var(--accent-red) 20px)',
          animation: 'stripe-move 20s linear infinite'
        }} />
      </div>

      <div className="relative flex flex-col items-center gap-8 max-w-md text-center reveal-up">
        {/* Error Icon */}
        <div className="relative">
          {/* Pulsing ring */}
          <div className="absolute inset-0 rounded-2xl bg-accent-red/20 animate-ping" style={{ animationDuration: '2s' }} />
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-accent-red/30 to-accent-orange/20 blur-xl opacity-60" />

          <div className="relative flex items-center justify-center h-20 w-20 rounded-2xl bg-gradient-to-br from-accent-red/20 to-accent-orange/10 border border-accent-red/30 backdrop-blur-sm">
            <AlertOctagon className="h-10 w-10 text-accent-red drop-shadow-[0_0_8px_rgba(255,61,61,0.5)]" />
          </div>
        </div>

        {/* Text content */}
        <div className="space-y-3">
          <h2 className="text-2xl font-bold text-foreground font-display tracking-tight">
            System Error Detected
          </h2>
          <p className="text-foreground-muted leading-relaxed">
            {error.message || "An unexpected error occurred while processing your request. Our systems are working to resolve this."}
          </p>

          {/* Error ID badge */}
          {error.digest && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 mt-2 rounded-lg bg-background-secondary/80 border border-border/50">
              <span className="text-xs text-foreground-dim font-mono">ID: {error.digest}</span>
              <button
                onClick={copyErrorId}
                className="p-1 rounded hover:bg-background-tertiary transition-colors"
                title="Copy error ID"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-accent-green" />
                ) : (
                  <Copy className="h-3 w-3 text-foreground-muted" />
                )}
              </button>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-4">
          <Button
            size="lg"
            onClick={reset}
            className="magnetic-hover bg-gradient-to-r from-accent-red to-accent-orange text-white hover:opacity-90 gap-2 shadow-lg shadow-accent-red/20"
          >
            <RefreshCcw className="h-4 w-4" />
            Try Again
          </Button>
          <Button
            variant="outline"
            size="lg"
            asChild
            className="magnetic-hover bg-background-secondary/50 backdrop-blur-sm border-border/50 hover:border-border gap-2"
          >
            <Link href="/overview">
              <Home className="h-4 w-4" />
              Go Home
            </Link>
          </Button>
        </div>

        {/* Help text */}
        <p className="text-xs text-foreground-dim">
          If this problem persists, please contact support with the error ID above.
        </p>
      </div>
    </div>
  );
}
