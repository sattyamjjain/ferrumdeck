"use client";

import { X, CheckCircle2, XCircle, Wrench, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPercentage, cn } from "@/lib/utils";
import type { ScorerResult } from "@/types/eval";

interface RegressionDiffProps {
  expected: string;
  actual: string;
  expectedToolCalls?: string[];
  actualToolCalls?: string[];
  scorerResults?: ScorerResult[];
  onClose?: () => void;
}

export function RegressionDiff({
  expected,
  actual,
  expectedToolCalls,
  actualToolCalls,
  scorerResults,
  onClose,
}: RegressionDiffProps) {
  const hasToolCalls =
    (expectedToolCalls && expectedToolCalls.length > 0) ||
    (actualToolCalls && actualToolCalls.length > 0);

  return (
    <div className="rounded-lg border border-border bg-background-secondary">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h4 className="text-sm font-medium">Comparison View</h4>
        {onClose && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <Tabs defaultValue="output" className="w-full">
        <div className="px-4 pt-3">
          <TabsList>
            <TabsTrigger value="output">Output</TabsTrigger>
            {hasToolCalls && (
              <TabsTrigger value="tools">Tool Calls</TabsTrigger>
            )}
            {scorerResults && scorerResults.length > 0 && (
              <TabsTrigger value="scorers">Scorers</TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent value="output" className="mt-0">
          <div className="grid grid-cols-2 divide-x divide-border">
            {/* Expected */}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Badge variant="outline" className="text-xs">
                  Expected
                </Badge>
              </div>
              <ScrollArea className="h-[200px]">
                <DiffContent content={expected} type="expected" />
              </ScrollArea>
            </div>

            {/* Actual */}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Badge variant="outline" className="text-xs">
                  Actual
                </Badge>
              </div>
              <ScrollArea className="h-[200px]">
                <DiffContent content={actual} type="actual" compare={expected} />
              </ScrollArea>
            </div>
          </div>
        </TabsContent>

        {hasToolCalls && (
          <TabsContent value="tools" className="mt-0">
            <div className="grid grid-cols-2 divide-x divide-border">
              {/* Expected Tool Calls */}
              <div className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="outline" className="text-xs">
                    Expected Tools
                  </Badge>
                </div>
                <div className="space-y-2">
                  {expectedToolCalls && expectedToolCalls.length > 0 ? (
                    expectedToolCalls.map((tool, index) => (
                      <ToolCallItem
                        key={index}
                        tool={tool}
                        index={index}
                        isMatch={actualToolCalls?.includes(tool)}
                      />
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground italic">
                      No expected tool calls
                    </div>
                  )}
                </div>
              </div>

              {/* Actual Tool Calls */}
              <div className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="outline" className="text-xs">
                    Actual Tools
                  </Badge>
                </div>
                <div className="space-y-2">
                  {actualToolCalls && actualToolCalls.length > 0 ? (
                    actualToolCalls.map((tool, index) => (
                      <ToolCallItem
                        key={index}
                        tool={tool}
                        index={index}
                        isMatch={expectedToolCalls?.includes(tool)}
                        isExtra={!expectedToolCalls?.includes(tool)}
                      />
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground italic">
                      No tool calls made
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Tool call sequence comparison */}
            {expectedToolCalls &&
              actualToolCalls &&
              expectedToolCalls.length > 0 &&
              actualToolCalls.length > 0 && (
                <div className="px-4 pb-4">
                  <div className="p-3 rounded-lg bg-muted/30 border border-border">
                    <div className="text-xs font-medium mb-2 text-muted-foreground">
                      Sequence Comparison
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">
                          Expected:
                        </span>
                        {expectedToolCalls.map((tool, i) => (
                          <span key={i} className="flex items-center gap-1">
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5"
                            >
                              {tool}
                            </Badge>
                            {i < expectedToolCalls.length - 1 && (
                              <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap mt-2">
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">
                          Actual:
                        </span>
                        {actualToolCalls.map((tool, i) => {
                          const isExpected = expectedToolCalls[i] === tool;
                          return (
                            <span key={i} className="flex items-center gap-1">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px] px-1.5",
                                  isExpected
                                    ? "border-green-500/50 text-green-400"
                                    : "border-red-500/50 text-red-400"
                                )}
                              >
                                {tool}
                              </Badge>
                              {i < actualToolCalls.length - 1 && (
                                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
          </TabsContent>
        )}

        {scorerResults && scorerResults.length > 0 && (
          <TabsContent value="scorers" className="mt-0 p-4">
            <div className="space-y-3">
              {scorerResults.map((result) => (
                <ScorerResultCard key={result.scorer_id} result={result} />
              ))}
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

interface DiffContentProps {
  content: string;
  type: "expected" | "actual";
  compare?: string;
}

function DiffContent({ content, type, compare }: DiffContentProps) {
  if (!content) {
    return (
      <div className="text-sm text-muted-foreground italic">No content</div>
    );
  }

  // Simple line-by-line diff visualization
  const lines = content.split("\n");
  const compareLines = compare?.split("\n") || [];

  return (
    <div className="font-mono text-xs leading-relaxed">
      {lines.map((line, index) => {
        const compareLine = compareLines[index];
        const isDifferent = type === "actual" && compare && line !== compareLine;

        return (
          <div
            key={index}
            className={cn(
              "px-2 py-0.5 rounded-sm",
              isDifferent && type === "actual" && "bg-yellow-500/10"
            )}
          >
            <span className="select-none text-muted-foreground/50 w-6 inline-block">
              {index + 1}
            </span>
            <span
              className={cn(
                isDifferent && type === "actual" && "text-yellow-400"
              )}
            >
              {line || " "}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface ToolCallItemProps {
  tool: string;
  index: number;
  isMatch?: boolean;
  isExtra?: boolean;
}

function ToolCallItem({ tool, index, isMatch, isExtra }: ToolCallItemProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 p-2 rounded-lg border",
        isMatch
          ? "bg-green-500/10 border-green-500/30"
          : isExtra
          ? "bg-red-500/10 border-red-500/30"
          : "bg-muted/30 border-border"
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center h-5 w-5 rounded text-[10px] font-medium",
          isMatch
            ? "bg-green-500/20 text-green-400"
            : isExtra
            ? "bg-red-500/20 text-red-400"
            : "bg-muted text-muted-foreground"
        )}
      >
        {index + 1}
      </div>
      <Wrench
        className={cn(
          "h-3.5 w-3.5",
          isMatch
            ? "text-green-400"
            : isExtra
            ? "text-red-400"
            : "text-muted-foreground"
        )}
      />
      <span
        className={cn(
          "text-sm font-medium",
          isMatch
            ? "text-green-400"
            : isExtra
            ? "text-red-400"
            : "text-foreground"
        )}
      >
        {tool}
      </span>
      {isMatch && <CheckCircle2 className="h-3.5 w-3.5 text-green-400 ml-auto" />}
      {isExtra && <XCircle className="h-3.5 w-3.5 text-red-400 ml-auto" />}
    </div>
  );
}

interface ScorerResultCardProps {
  result: ScorerResult;
}

function ScorerResultCard({ result }: ScorerResultCardProps) {
  return (
    <div
      className={cn(
        "p-3 rounded-lg border",
        result.passed
          ? "bg-green-500/10 border-green-500/30"
          : "bg-red-500/10 border-red-500/30"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {result.passed ? (
            <CheckCircle2 className="h-4 w-4 text-green-400" />
          ) : (
            <XCircle className="h-4 w-4 text-red-400" />
          )}
          <span className="font-medium">{result.scorer_name}</span>
        </div>
        <span
          className={cn(
            "text-sm font-medium",
            result.passed ? "text-green-400" : "text-red-400"
          )}
        >
          {formatPercentage(result.score)}
        </span>
      </div>
      {result.details && (
        <p className="text-xs text-muted-foreground">{result.details}</p>
      )}
      {result.metadata && Object.keys(result.metadata).length > 0 && (
        <div className="mt-2 pt-2 border-t border-border/50">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
            Metadata
          </div>
          <pre className="text-[10px] font-mono text-muted-foreground overflow-x-auto">
            {JSON.stringify(result.metadata, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
