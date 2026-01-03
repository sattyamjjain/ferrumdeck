"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Play, Sparkles } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { createRun } from "@/lib/api/runs";

export function CreateRunDialog() {
  // Hydration fix - ensure client-only rendering for Radix components
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [task, setTask] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => createRun({ agent_id: agentId || undefined, input: { task } }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      toast.success(`Run created: ${data.run_id}`);
      setOpen(false);
      setAgentId("");
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
              <Label htmlFor="agent" className="text-sm font-medium">
                Agent ID
                <span className="ml-1 text-xs text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="agent"
                placeholder="agt_01HGXK..."
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="font-mono text-sm bg-background border-border/50 focus:border-accent-blue"
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to use the default agent configuration.
              </p>
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
              disabled={mutation.isPending || !task.trim()}
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
