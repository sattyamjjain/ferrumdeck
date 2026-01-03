"use client";

import { Copy, Check, AlertTriangle } from "lucide-react";
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JsonViewer } from "@/components/shared/json-viewer";
import { cn, copyToClipboard } from "@/lib/utils";
import { toast } from "sonner";
import type { Run, AgenticOutput } from "@/types/run";

interface InputOutputTabProps {
  run: Run;
  className?: string;
}

export function InputOutputTab({ run, className }: InputOutputTabProps) {
  return (
    <div className={cn("grid gap-6 lg:grid-cols-2", className)}>
      {/* Input Section */}
      <InputSection input={run.input} />

      {/* Output Section */}
      <OutputSection
        output={run.output}
        error={run.error}
        status={run.status}
      />
    </div>
  );
}

interface InputSectionProps {
  input: Record<string, unknown>;
}

function InputSection({ input }: InputSectionProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const success = await copyToClipboard(JSON.stringify(input, null, 2));
    if (success) {
      setCopied(true);
      toast.success("Input copied");
      setTimeout(() => setCopied(false), 2000);
    }
  }, [input]);

  const taskString =
    input && typeof input.task === "string" ? input.task : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Run Input</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-accent-green" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            <span className="ml-1 text-xs">Copy</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {taskString && (
          <div className="mb-4 p-3 rounded-md bg-background-tertiary/50 border border-border/50">
            <p className="text-xs text-muted-foreground mb-1 font-medium">
              Task
            </p>
            <p className="text-sm">{taskString}</p>
          </div>
        )}

        {input && Object.keys(input).length > 0 ? (
          <JsonViewer
            data={input}
            maxHeight={350}
            searchable
            showLineNumbers
          />
        ) : (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No input data
          </p>
        )}
      </CardContent>
    </Card>
  );
}

interface OutputSectionProps {
  output: Run["output"];
  error: Run["error"];
  status: Run["status"];
}

function OutputSection({ output, error, status }: OutputSectionProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const content =
      typeof output === "string" ? output : JSON.stringify(output, null, 2);
    const success = await copyToClipboard(content);
    if (success) {
      setCopied(true);
      toast.success("Output copied");
      setTimeout(() => setCopied(false), 2000);
    }
  }, [output]);

  const isAgentic = isAgenticOutput(output);
  const agenticOutput = isAgentic ? (output as AgenticOutput) : null;

  return (
    <Card className={cn(error && "border-red-500/20")}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle
            className={cn(
              "text-sm font-medium",
              error && "text-red-400"
            )}
          >
            {error ? "Error" : "Run Output"}
          </CardTitle>
          {output && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-accent-green" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span className="ml-1 text-xs">Copy</span>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Error display */}
        {error && (
          <div className="mb-4 p-3 rounded-md bg-red-500/10 border border-red-500/20">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm text-red-400 font-medium">
                  {typeof error === "object" &&
                  "message" in (error as Record<string, unknown>)
                    ? String((error as Record<string, unknown>).message)
                    : "Run execution failed"}
                </p>
                {typeof error === "object" &&
                  "code" in (error as Record<string, unknown>) && (
                    <p className="text-xs text-red-400/70 mt-1 font-mono">
                      Code: {String((error as Record<string, unknown>).code)}
                    </p>
                  )}
              </div>
            </div>
          </div>
        )}

        {/* Agentic output with structured display */}
        {agenticOutput && (
          <div className="space-y-4">
            {/* Response */}
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium">
                Response
              </p>
              <div className="p-3 rounded-md bg-background-tertiary/50 border border-border/50">
                <p className="text-sm whitespace-pre-wrap">
                  {agenticOutput.response}
                </p>
              </div>
            </div>

            {/* Tool calls summary */}
            {agenticOutput.tool_calls && agenticOutput.tool_calls.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium">
                  Tool Calls ({agenticOutput.tool_calls.length})
                </p>
                <div className="space-y-2">
                  {agenticOutput.tool_calls.map((call, i) => (
                    <div
                      key={i}
                      className={cn(
                        "p-2 rounded-md border text-xs",
                        call.success
                          ? "bg-green-500/5 border-green-500/20"
                          : "bg-red-500/5 border-red-500/20"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-medium">
                          {call.tool_name}
                          {call.tool_version && (
                            <span className="text-muted-foreground ml-1">
                              v{call.tool_version}
                            </span>
                          )}
                        </span>
                        <span
                          className={
                            call.success ? "text-green-400" : "text-red-400"
                          }
                        >
                          {call.success ? "Success" : "Failed"}
                        </span>
                      </div>
                      {call.output_preview && (
                        <p className="text-muted-foreground mt-1 truncate">
                          {call.output_preview}
                        </p>
                      )}
                      {call.error && (
                        <p className="text-red-400 mt-1">{call.error}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Iterations */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
              <span>Iterations: {agenticOutput.iterations}</span>
              <span>Status: {agenticOutput.status}</span>
            </div>
          </div>
        )}

        {/* String output */}
        {output && typeof output === "string" && (
          <pre className="bg-background-tertiary rounded-md p-4 text-sm overflow-auto max-h-96 whitespace-pre-wrap font-mono">
            {output}
          </pre>
        )}

        {/* Object output (non-agentic) */}
        {output && typeof output === "object" && !isAgentic && (
          <JsonViewer
            data={output}
            maxHeight={350}
            searchable
            showLineNumbers
          />
        )}

        {/* Error details JSON */}
        {error && (
          <div className="mt-4">
            <p className="text-xs text-muted-foreground mb-2 font-medium">
              Error Details
            </p>
            <JsonViewer data={error} maxHeight={250} />
          </div>
        )}

        {/* No output state */}
        {!output && !error && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {status === "running" || status === "queued" || status === "created"
              ? "Output will appear when the run completes"
              : "No output data"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function isAgenticOutput(output: Run["output"]): output is AgenticOutput {
  if (!output || typeof output !== "object") return false;
  const obj = output as Record<string, unknown>;
  return (
    typeof obj.response === "string" &&
    Array.isArray(obj.tool_calls) &&
    typeof obj.iterations === "number"
  );
}
