"use client";

import { useState } from "react";
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
import { Plus, Wrench, AlertCircle, Shield, FileEdit, Trash2 } from "lucide-react";
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

function getRiskLevelInfo(level: ToolRiskLevel) {
  switch (level) {
    case "read":
      return {
        icon: <Shield className="h-4 w-4 text-emerald-400" />,
        color: "text-emerald-400",
        bgColor: "bg-emerald-500/10",
        description: "Read-only access. No data modification.",
      };
    case "write":
      return {
        icon: <FileEdit className="h-4 w-4 text-amber-400" />,
        color: "text-amber-400",
        bgColor: "bg-amber-500/10",
        description: "Can modify data. Requires caution.",
      };
    case "destructive":
      return {
        icon: <Trash2 className="h-4 w-4 text-red-400" />,
        color: "text-red-400",
        bgColor: "bg-red-500/10",
        description: "Can delete data. High risk operations.",
      };
  }
}

interface CreateToolDialogProps {
  trigger?: React.ReactNode;
}

export function CreateToolDialog({ trigger }: CreateToolDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [mcpServer, setMcpServer] = useState("");
  const [riskLevel, setRiskLevel] = useState<ToolRiskLevel>("read");
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
    setRiskLevel("read");
    setStatus("active");
    setErrors({});
  };

  const riskInfo = getRiskLevelInfo(riskLevel);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button className="gap-2 bg-purple-600 hover:bg-purple-700">
            <Plus className="h-4 w-4" />
            New Tool
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-purple-400" />
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
              <span className="text-red-400">*</span>
            </Label>
            <Input
              id="tool-name"
              placeholder="e.g., File System"
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
                A human-readable name for the tool
              </p>
            )}
          </div>

          {/* Slug */}
          <div className="space-y-2">
            <Label htmlFor="tool-slug" className="flex items-center gap-1">
              Slug
              <span className="text-red-400">*</span>
            </Label>
            <Input
              id="tool-slug"
              placeholder="e.g., file-system"
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
                A unique identifier used in tool calls
              </p>
            )}
          </div>

          {/* MCP Server */}
          <div className="space-y-2">
            <Label htmlFor="mcp-server" className="flex items-center gap-1">
              MCP Server
              <span className="text-red-400">*</span>
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
              className={`bg-slate-900/50 border-slate-700 font-mono ${
                errors.mcpServer ? "border-red-500" : ""
              }`}
            />
            {errors.mcpServer ? (
              <p className="text-xs text-red-400 flex items-center gap-1">
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
              className="bg-slate-900/50 border-slate-700 min-h-[80px] resize-none"
            />
          </div>

          {/* Risk Level */}
          <div className="space-y-2">
            <Label>Risk Level</Label>
            <Select value={riskLevel} onValueChange={(v) => setRiskLevel(v as ToolRiskLevel)}>
              <SelectTrigger className="bg-slate-900/50 border-slate-700">
                <SelectValue placeholder="Select risk level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-emerald-400" />
                    Read Only
                  </div>
                </SelectItem>
                <SelectItem value="write">
                  <div className="flex items-center gap-2">
                    <FileEdit className="h-4 w-4 text-amber-400" />
                    Write
                  </div>
                </SelectItem>
                <SelectItem value="destructive">
                  <div className="flex items-center gap-2">
                    <Trash2 className="h-4 w-4 text-red-400" />
                    Destructive
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
              <SelectTrigger className="bg-slate-900/50 border-slate-700">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-400" />
                    Active
                  </div>
                </SelectItem>
                <SelectItem value="disabled">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-slate-400" />
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
            className="bg-purple-600 hover:bg-purple-700"
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
