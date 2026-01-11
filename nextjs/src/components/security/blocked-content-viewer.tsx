"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Copy,
  Check,
  ShieldX,
} from "lucide-react";

interface BlockedContentViewerProps {
  content: Record<string, unknown>;
  title?: string;
  className?: string;
  maxPreviewLines?: number;
}

export function BlockedContentViewer({
  content,
  title = "Blocked Content",
  className,
  maxPreviewLines = 6,
}: BlockedContentViewerProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const contentString = JSON.stringify(content, null, 2);
  const lines = contentString.split("\n");
  const needsExpand = lines.length > maxPreviewLines;
  const displayContent = expanded
    ? contentString
    : lines.slice(0, maxPreviewLines).join("\n") + (needsExpand ? "\n..." : "");

  const handleCopy = async () => {
    await navigator.clipboard.writeText(contentString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-red-500/10">
            <ShieldX className="h-4 w-4 text-red-400" />
          </div>
          <p className="text-xs font-semibold text-foreground uppercase tracking-wider">
            {title}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className={cn(
            "h-7 px-2.5 text-xs transition-all",
            copied
              ? "bg-emerald-500/10 text-emerald-400"
              : "hover:bg-secondary"
          )}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 mr-1.5" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3 mr-1.5" />
              Copy
            </>
          )}
        </Button>
      </div>

      {/* Content container */}
      <div
        className={cn(
          "relative rounded-xl border-2 overflow-hidden",
          "bg-gradient-to-br from-red-500/[0.03] to-orange-500/[0.02]",
          "border-red-500/20"
        )}
      >
        {/* Warning stripe */}
        <div className="h-1.5 w-full bg-gradient-to-r from-red-500 via-orange-500 to-red-500" />

        {/* Warning label */}
        <div className="flex items-center gap-2 px-4 py-2.5 bg-red-500/5 border-b border-red-500/10">
          <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
          <span className="text-xs font-medium text-red-400">
            Potentially dangerous content blocked
          </span>
        </div>

        {/* Code content */}
        <pre
          className={cn(
            "p-4 text-xs font-mono overflow-x-auto",
            "text-foreground-muted leading-relaxed",
            !expanded && needsExpand && "max-h-44"
          )}
        >
          <code>{displayContent}</code>
        </pre>

        {/* Expand/collapse button */}
        {needsExpand && (
          <div className="px-4 py-2.5 border-t border-red-500/10 bg-red-500/5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className={cn(
                "w-full h-7 text-xs font-medium",
                "text-muted-foreground hover:text-foreground",
                "hover:bg-red-500/10"
              )}
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5 mr-1.5" />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5 mr-1.5" />
                  Show all ({lines.length} lines)
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
