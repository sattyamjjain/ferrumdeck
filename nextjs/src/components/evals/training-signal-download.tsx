"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface TrainingSignalDownloadProps {
  /** Gateway run ids whose redacted training signal to export + concatenate. */
  runIds: string[];
  /** Optional per-run outcome scores (keyed by run id) sent as `run_score`. */
  runScores?: Record<string, number>;
  /** Base name for the downloaded file (".jsonl" is appended). */
  filename?: string;
  label?: string;
}

/**
 * "Download training signal" action (HarnessX trace->signal).
 *
 * POSTs to the per-run training-signal BFF route (which proxies the gateway's
 * redacted JSONL export — redaction happens server-side via the audit
 * redaction path), concatenates the lines across the given runs, and triggers a
 * client-side `.jsonl` download via the standard Blob pattern. Disabled when
 * there are no runs to export (e.g. a stub suite with no recorded runs).
 */
export function TrainingSignalDownload({
  runIds,
  runScores,
  filename = "training-signal",
  label = "Download training signal",
}: TrainingSignalDownloadProps) {
  const [busy, setBusy] = useState(false);
  const disabled = busy || runIds.length === 0;

  async function handleDownload() {
    setBusy(true);
    try {
      const chunks: string[] = [];
      for (const runId of runIds) {
        const runScore = runScores?.[runId];
        const response = await fetch(
          `/api/v1/runs/${runId}/training-signal`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              runScore != null ? { run_score: runScore } : {}
            ),
          }
        );
        if (!response.ok) {
          throw new Error(`run ${runId}: ${response.status}`);
        }
        const text = (await response.text()).trim();
        if (text) {
          chunks.push(text);
        }
      }

      const content = chunks.join("\n");
      if (!content) {
        toast.info("No training-signal rows for these runs yet.");
        return;
      }

      const blob = new Blob([content + "\n"], {
        type: "application/x-ndjson",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filename}.jsonl`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Training signal downloaded");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? `Export failed: ${error.message}`
          : "Failed to export training signal"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleDownload}
      disabled={disabled}
      title={
        runIds.length === 0
          ? "No recorded runs to export yet"
          : "Export the redacted (state, action, observation, outcome_score) JSONL"
      }
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5 mr-1" />
      )}
      {label}
    </Button>
  );
}
