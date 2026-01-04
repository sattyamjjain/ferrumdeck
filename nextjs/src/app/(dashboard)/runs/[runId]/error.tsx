"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCcw, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RunDetailError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("Run detail error:", error);
  }, [error]);

  const isNotFound = error.message?.toLowerCase().includes("not found");

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center p-6">
      <div className="flex flex-col items-center gap-6 max-w-md text-center">
        <div className={`rounded-full p-4 ${isNotFound ? "bg-amber-500/10" : "bg-red-500/10"}`}>
          <AlertTriangle className={`h-10 w-10 ${isNotFound ? "text-amber-400" : "text-red-400"}`} />
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">
            {isNotFound ? "Run Not Found" : "Error Loading Run"}
          </h2>
          <p className="text-sm text-foreground-muted">
            {isNotFound
              ? "The run you're looking for doesn't exist or may have been deleted."
              : error.message || "Unable to load run details. Please try again."
            }
          </p>
          {error.digest && (
            <p className="text-xs text-foreground-muted/60 font-mono">
              Error ID: {error.digest}
            </p>
          )}
        </div>

        <div className="flex gap-3">
          <Button variant="outline" asChild>
            <Link href="/runs" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to Runs
            </Link>
          </Button>
          {!isNotFound && (
            <Button
              variant="ghost"
              onClick={reset}
              className="gap-2"
            >
              <RefreshCcw className="h-4 w-4" />
              Try Again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
