"use client";

import { useState } from "react";
import { useIsMounted } from "@/hooks/use-is-mounted";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Play, Sparkles, Bot } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { createRun } from "@/lib/api/runs";
import { useAgents } from "@/hooks/use-agents";

export function CreateRunDialog() {
  // Hydration fix - ensure client-only rendering for Radix components
  const mounted = useIsMounted();

  const [open, setOpen] = useState(false);
  const [selectedAgentVersionId, setSelectedAgentVersionId] = useState("");
  const [task, setTask] = useState("");
  const queryClient = useQueryClient();

  // Fetch agents for dropdown
  const { data: agents, isLoading: agentsLoading } = useAgents({ status: "active" });

  // Find selected agent for display and API request
  const selectedAgent = agents?.find(
    (a) => a.latest_version?.id === selectedAgentVersionId
  );

  const mutation = useMutation({
    mutationFn: () =>
      createRun({
        agent_id: selectedAgent?.id,
        agent_version: selectedAgentVersionId || undefined,
        input: { task },
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      toast.success(`Run created: ${data.run_id}`);
      setOpen(false);
      setSelectedAgentVersionId("");
      setTask("");
    },
    onError: () => {
      toast.error("Failed to create run");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim()) {
      toast.error("Task is required");
      return;
    }
    if (!selectedAgentVersionId) {
      toast.error("Please select an agent");
      return;
    }
    mutation.mutate();
  };

  // Render just the trigger button during SSR to avoid hydration mismatch
  if (!mounted) {
    return (
      <Button className="bg-accent-blue hover:bg-accent-blue/90 text-white gap-2">
        <Plus className="h-4 w-4" />
        New Run
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-accent-blue hover:bg-accent-blue/90 text-white gap-2">
          <Plus className="h-4 w-4" />
          New Run
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg bg-background-secondary border-border/50">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <div className="p-2 rounded-lg bg-accent-blue/10">
                <Play className="h-4 w-4 text-accent-blue" />
              </div>
              Create New Run
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Start a new agent execution with a task description.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 py-5">
            <div className="grid gap-2">
              <Label htmlFor="agent" className="text-sm font-medium flex items-center gap-2">
                <Bot className="h-3.5 w-3.5 text-accent-purple" />
                Agent
              </Label>
              <Select
                value={selectedAgentVersionId}
                onValueChange={setSelectedAgentVersionId}
              >
                <SelectTrigger
                  id="agent"
                  className="bg-background border-border/50 focus:border-accent-blue"
                >
                  <SelectValue placeholder="Select an agent..." />
                </SelectTrigger>
                <SelectContent className="bg-background-elevated border-border/50">
                  {agentsLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : agents && agents.length > 0 ? (
                    agents.map((agent) =>
                      agent.latest_version ? (
                        <SelectItem
                          key={agent.latest_version.id}
                          value={agent.latest_version.id}
                          className="cursor-pointer"
                        >
                          <div className="flex flex-col">
                            <span className="font-medium">{agent.name}</span>
                            <span className="text-xs text-muted-foreground">
                              v{agent.latest_version.version} · {agent.latest_version.model}
                            </span>
                          </div>
                        </SelectItem>
                      ) : null
                    )
                  ) : (
                    <div className="py-4 text-center text-sm text-muted-foreground">
                      No active agents available
                    </div>
                  )}
                </SelectContent>
              </Select>
              {selectedAgent && (
                <p className="text-xs text-muted-foreground">
                  Using {selectedAgent.name} v{selectedAgent.latest_version?.version}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="task" className="text-sm font-medium flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-accent-purple" />
                Task Description
              </Label>
              <Textarea
                id="task"
                placeholder="Describe what you want the agent to accomplish..."
                value={task}
                onChange={(e) => setTask(e.target.value)}
                rows={4}
                className="bg-background border-border/50 focus:border-accent-blue resize-none"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              className="border-border/50"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !task.trim() || !selectedAgentVersionId}
              className="bg-accent-blue hover:bg-accent-blue/90 text-white gap-2"
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Start Run
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
