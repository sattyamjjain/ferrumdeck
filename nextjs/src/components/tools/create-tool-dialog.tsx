"use client";

import { useState, useEffect } from "react";
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
import { Plus, Wrench, AlertCircle, Shield, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { useCreateTool } from "@/hooks/use-tools";
import type { ToolRiskLevel, ToolStatus } from "@/types/tool";

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const riskLevelInfo: Record<ToolRiskLevel, { icon: React.ReactNode; color: string; bgColor: string; description: string }> = {
  low: {
    icon: <Shield className="h-4 w-4 text-accent-green" />,
    color: "text-accent-green",
    bgColor: "bg-accent-green/10",
    description: "Read-only or minimal impact. Safe for autonomous execution.",
  },
  medium: {
    icon: <AlertTriangle className="h-4 w-4 text-accent-yellow" />,
    color: "text-accent-yellow",
    bgColor: "bg-accent-yellow/10",
    description: "Can modify non-critical data. Periodic review recommended.",
  },
  high: {
    icon: <AlertTriangle className="h-4 w-4 text-accent-orange" />,
    color: "text-accent-orange",
    bgColor: "bg-accent-orange/10",
    description: "Can modify important data. Should be monitored closely.",
  },
  critical: {
    icon: <AlertTriangle className="h-4 w-4 text-accent-red" />,
    color: "text-accent-red",
    bgColor: "bg-accent-red/10",
    description: "Destructive or irreversible operations. Requires approval.",
  },
};

interface CreateToolDialogProps {
  trigger?: React.ReactNode;
}

export function CreateToolDialog({ trigger }: CreateToolDialogProps) {
  // Hydration fix - ensure client-only rendering for Radix components
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [mcpServer, setMcpServer] = useState("");
  const [riskLevel, setRiskLevel] = useState<ToolRiskLevel>("low");
  const [status, setStatus] = useState<ToolStatus>("active");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createMutation = useCreateTool();

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

    if (!mcpServer.trim()) {
      newErrors.mcpServer = "MCP server is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCreate = async () => {
    if (!validate()) return;

    try {
      await createMutation.mutateAsync({
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || undefined,
        mcp_server: mcpServer.trim(),
        risk_level: riskLevel,
        status,
      });

      toast.success(`Tool "${name}" created successfully`);
      handleClose();
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
    setMcpServer("");
    setRiskLevel("low");
    setStatus("active");
    setErrors({});
  };

  const riskInfo = riskLevelInfo[riskLevel];

  // Render just the trigger button during SSR to avoid hydration mismatch
  if (!mounted) {
    return trigger || (
      <Button className="gap-2 bg-accent-cyan hover:bg-accent-cyan/90">
        <Plus className="h-4 w-4" />
        Register Tool
      </Button>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button className="gap-2 bg-accent-cyan hover:bg-accent-cyan/90">
            <Plus className="h-4 w-4" />
            Register Tool
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-accent-cyan" />
            Register New Tool
          </DialogTitle>
          <DialogDescription>
            Register a new MCP tool for agents to use. Tools connect to external services
            through MCP servers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="tool-name" className="flex items-center gap-1">
              Name
              <span className="text-accent-red">*</span>
            </Label>
            <Input
              id="tool-name"
              placeholder="e.g., File System"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              className={`bg-background-secondary border-border ${
                errors.name ? "border-accent-red" : ""
              }`}
            />
            {errors.name ? (
              <p className="text-xs text-accent-red flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.name}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                A human-readable name for the tool
              </p>
            )}
          </div>

          {/* Slug */}
          <div className="space-y-2">
            <Label htmlFor="tool-slug" className="flex items-center gap-1">
              Slug
              <span className="text-accent-red">*</span>
            </Label>
            <Input
              id="tool-slug"
              placeholder="e.g., file-system"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              className={`bg-background-secondary border-border font-mono ${
                errors.slug ? "border-accent-red" : ""
              }`}
            />
            {errors.slug ? (
              <p className="text-xs text-accent-red flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.slug}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                A unique identifier used in tool calls
              </p>
            )}
          </div>

          {/* MCP Server */}
          <div className="space-y-2">
            <Label htmlFor="mcp-server" className="flex items-center gap-1">
              MCP Server
              <span className="text-accent-red">*</span>
            </Label>
            <Input
              id="mcp-server"
              placeholder="e.g., mcp-filesystem"
              value={mcpServer}
              onChange={(e) => {
                setMcpServer(e.target.value);
                if (errors.mcpServer) {
                  setErrors((prev) => ({ ...prev, mcpServer: "" }));
                }
              }}
              className={`bg-background-secondary border-border font-mono ${
                errors.mcpServer ? "border-accent-red" : ""
              }`}
            />
            {errors.mcpServer ? (
              <p className="text-xs text-accent-red flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.mcpServer}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                The MCP server that provides this tool
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="tool-description">Description</Label>
            <Textarea
              id="tool-description"
              placeholder="Describe what this tool does..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="bg-background-secondary border-border min-h-[80px] resize-none"
            />
          </div>

          {/* Risk Level */}
          <div className="space-y-2">
            <Label>Risk Level</Label>
            <Select value={riskLevel} onValueChange={(v) => setRiskLevel(v as ToolRiskLevel)}>
              <SelectTrigger className="bg-background-secondary border-border">
                <SelectValue placeholder="Select risk level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-accent-green" />
                    Low
                  </div>
                </SelectItem>
                <SelectItem value="medium">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-accent-yellow" />
                    Medium
                  </div>
                </SelectItem>
                <SelectItem value="high">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-accent-orange" />
                    High
                  </div>
                </SelectItem>
                <SelectItem value="critical">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-accent-red" />
                    Critical
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <div className={`flex items-center gap-2 p-2 rounded-lg ${riskInfo.bgColor}`}>
              {riskInfo.icon}
              <p className={`text-xs ${riskInfo.color}`}>{riskInfo.description}</p>
            </div>
          </div>

          {/* Status */}
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ToolStatus)}>
              <SelectTrigger className="bg-background-secondary border-border">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-accent-green" />
                    Active
                  </div>
                </SelectItem>
                <SelectItem value="disabled">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-muted-foreground" />
                    Disabled
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={createMutation.isPending}
            className="bg-accent-cyan hover:bg-accent-cyan/90"
          >
            {createMutation.isPending ? (
              <>
                <LoadingSpinner size="sm" />
                <span className="ml-2">Creating...</span>
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Create Tool
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
