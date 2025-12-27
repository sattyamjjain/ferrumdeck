"use client";

import { Activity } from "lucide-react";
import { useRun, useSteps } from "@/hooks/use-runs";
import { RunHeader } from "./run-header";
import { StepTimeline } from "./step-timeline";
import { LoadingPage } from "@/components/shared/loading-spinner";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { JsonViewer } from "@/components/shared/json-viewer";

interface RunDetailProps {
  runId: string;
}

export function RunDetail({ runId }: RunDetailProps) {
  const { data: run, isLoading: runLoading, error: runError } = useRun(runId);
  const { data: steps, isLoading: stepsLoading } = useSteps(runId);

  if (runLoading) {
    return <LoadingPage />;
  }

  if (runError || !run) {
    return (
      <EmptyState
        icon={Activity}
        title="Run not found"
        description="The run you're looking for doesn't exist or has been deleted."
      />
    );
  }

  return (
    <div className="space-y-6">
      <RunHeader run={run} />

      <Tabs defaultValue="steps" className="w-full">
        <TabsList>
          <TabsTrigger value="steps">Steps</TabsTrigger>
          <TabsTrigger value="input">Input</TabsTrigger>
          <TabsTrigger value="output">Output</TabsTrigger>
          {run.error && <TabsTrigger value="error">Error</TabsTrigger>}
        </TabsList>

        <TabsContent value="steps" className="mt-4">
          {stepsLoading ? (
            <LoadingPage />
          ) : steps && steps.length > 0 ? (
            <StepTimeline steps={steps} />
          ) : (
            <EmptyState
              icon={Activity}
              title="No steps yet"
              description="Steps will appear here once the run starts executing."
            />
          )}
        </TabsContent>

        <TabsContent value="input" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Run Input</CardTitle>
            </CardHeader>
            <CardContent>
              {run.input ? (
                <JsonViewer data={run.input} />
              ) : (
                <p className="text-sm text-muted-foreground">No input data</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="output" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Run Output</CardTitle>
            </CardHeader>
            <CardContent>
              {run.output ? (
                typeof run.output === "string" ? (
                  <pre className="bg-background-tertiary rounded-md p-4 text-sm overflow-auto whitespace-pre-wrap">
                    {run.output}
                  </pre>
                ) : (
                  <JsonViewer data={run.output} />
                )
              ) : (
                <p className="text-sm text-muted-foreground">No output data</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {run.error && (
          <TabsContent value="error" className="mt-4">
            <Card className="border-red-500/20">
              <CardHeader>
                <CardTitle className="text-sm text-red-400">Error Details</CardTitle>
              </CardHeader>
              <CardContent>
                <JsonViewer data={run.error} />
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
