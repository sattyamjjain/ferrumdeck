"use client";

import { useState } from "react";
import { useIsMounted } from "@/hooks/use-is-mounted";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Bot, Sparkles, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { useCreateAgent } from "@/hooks/use-agents";
import type { AgentStatus } from "@/types/agent";

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

interface CreateAgentDialogProps {
  trigger?: React.ReactNode;
}

export function CreateAgentDialog({ trigger }: CreateAgentDialogProps) {
  // Hydration fix - ensure client-only rendering for Radix components
  const mounted = useIsMounted();

  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<AgentStatus>("draft");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createMutation = useCreateAgent();

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugManuallyEdited) {
      setSlug(generateSlug(value));
    }
    if (errors.name) {
      setErrors((prev) => ({ ...prev, name: "" }));
    }
  };

  const handleSlugChange = (value: string) => {
    setSlug(value);
    setSlugManuallyEdited(true);
    if (errors.slug) {
      setErrors((prev) => ({ ...prev, slug: "" }));
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = "Name is required";
    } else if (name.length < 2) {
      newErrors.name = "Name must be at least 2 characters";
    } else if (name.length > 100) {
      newErrors.name = "Name must be less than 100 characters";
    }

    if (!slug.trim()) {
      newErrors.slug = "Slug is required";
    } else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      newErrors.slug = "Slug must be lowercase alphanumeric with hyphens";
    } else if (slug.length > 50) {
      newErrors.slug = "Slug must be less than 50 characters";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCreate = async () => {
    if (!validate()) return;

    try {
      const result = await createMutation.mutateAsync({
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || undefined,
        status,
      });

      toast.success(`Agent "${name}" created successfully`);
      handleClose();

      // Navigate to the new agent
      if (result?.id) {
        router.push(`/agents/${result.id}`);
      }
    } catch {
      // Error is handled by the mutation
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setName("");
    setSlug("");
    setSlugManuallyEdited(false);
    setDescription("");
    setStatus("draft");
    setErrors({});
  };

  // Render just the trigger button during SSR to avoid hydration mismatch
  if (!mounted) {
    return trigger || (
      <Button className="gap-2 bg-indigo-600 hover:bg-indigo-700">
        <Plus className="h-4 w-4" />
        New Agent
      </Button>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button className="gap-2 bg-indigo-600 hover:bg-indigo-700">
            <Plus className="h-4 w-4" />
            New Agent
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-indigo-400" />
            Create New Agent
          </DialogTitle>
          <DialogDescription>
            Create a new AI agent to handle specific tasks. You can configure the agent&apos;s
            model, prompts, and tools after creation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="agent-name" className="flex items-center gap-1">
              Name
              <span className="text-red-400">*</span>
            </Label>
            <Input
              id="agent-name"
              placeholder="e.g., Code Assistant"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              className={`bg-slate-900/50 border-slate-700 ${
                errors.name ? "border-red-500" : ""
              }`}
            />
            {errors.name ? (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.name}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                A human-readable name for the agent
              </p>
            )}
          </div>

          {/* Slug */}
          <div className="space-y-2">
            <Label htmlFor="agent-slug" className="flex items-center gap-1">
              Slug
              <span className="text-red-400">*</span>
            </Label>
            <Input
              id="agent-slug"
              placeholder="e.g., code-assistant"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              className={`bg-slate-900/50 border-slate-700 font-mono ${
                errors.slug ? "border-red-500" : ""
              }`}
            />
            {errors.slug ? (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.slug}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                A unique identifier used in API calls
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="agent-description">Description</Label>
            <Textarea
              id="agent-description"
              placeholder="Describe what this agent does..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="bg-slate-900/50 border-slate-700 min-h-[80px] resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Optional description of the agent&apos;s purpose
            </p>
          </div>

          {/* Status */}
          <div className="space-y-2">
            <Label>Initial Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as AgentStatus)}>
              <SelectTrigger className="bg-slate-900/50 border-slate-700">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-slate-400" />
                    Draft
                  </div>
                </SelectItem>
                <SelectItem value="active">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-400" />
                    Active
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Draft agents are not available for runs until activated
            </p>
          </div>

          {/* Info Box */}
          <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-4">
            <div className="flex items-start gap-2">
              <Sparkles className="h-5 w-5 text-indigo-400 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-indigo-400">Next Steps</p>
                <p className="text-xs text-muted-foreground">
                  After creating the agent, you&apos;ll need to create a version with model
                  configuration, system prompt, and tool permissions before it can be used.
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={createMutation.isPending}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            {createMutation.isPending ? (
              <>
                <LoadingSpinner size="sm" />
                <span className="ml-2">Creating...</span>
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Create Agent
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
