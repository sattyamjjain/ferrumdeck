"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { AirlockConfig } from "@/types/security";
import {
  useAirlockConfig,
  useUpdateAirlockConfig,
  useToggleAirlockMode,
} from "@/hooks/use-security";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Shield,
  ShieldAlert,
  Loader2,
  AlertTriangle,
  Save,
  Zap,
  Globe,
  Activity,
  Lock,
} from "lucide-react";
import { toast } from "sonner";

interface AirlockSettingsCardProps {
  className?: string;
}

export function AirlockSettingsCard({ className }: AirlockSettingsCardProps) {
  const { data: config, isLoading, error } = useAirlockConfig();
  const toggleMode = useToggleAirlockMode();
  const updateConfig = useUpdateAirlockConfig();

  const [localConfig, setLocalConfig] = useState<Partial<AirlockConfig>>({});
  const [hasChanges, setHasChanges] = useState(false);

  const handleToggleMode = async () => {
    try {
      await toggleMode.mutateAsync(config?.mode || "shadow");
      toast.success(
        `Airlock mode changed to ${config?.mode === "shadow" ? "Enforce" : "Shadow"}`
      );
    } catch {
      toast.error("Failed to toggle Airlock mode");
    }
  };

  const handleSave = async () => {
    try {
      await updateConfig.mutateAsync(localConfig);
      setHasChanges(false);
      toast.success("Airlock configuration saved");
    } catch {
      toast.error("Failed to save Airlock configuration");
    }
  };

  const updateLocalConfig = (key: keyof AirlockConfig, value: unknown) => {
    setLocalConfig((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  if (isLoading) {
    return (
      <Card className={cn("overflow-hidden", className)}>
        <CardContent className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-accent-primary" />
            <p className="text-sm text-muted-foreground">Loading configuration...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={cn("overflow-hidden border-red-500/20", className)}>
        <CardContent className="flex flex-col items-center justify-center py-16 text-foreground-muted">
          <div className="p-3 rounded-full bg-red-500/10 mb-3">
            <AlertTriangle className="h-8 w-8 text-red-500" />
          </div>
          <p className="text-sm font-medium text-foreground">Failed to load configuration</p>
          <p className="text-xs text-muted-foreground mt-1">Please check your connection and try again</p>
        </CardContent>
      </Card>
    );
  }

  const effectiveConfig = { ...config, ...localConfig } as AirlockConfig;
  const isEnforceMode = effectiveConfig.mode === "enforce";

  return (
    <Card
      className={cn(
        "overflow-hidden transition-all duration-300",
        isEnforceMode
          ? "border-red-500/30 shadow-[0_0_30px_rgba(239,68,68,0.08)]"
          : "border-amber-500/30 shadow-[0_0_30px_rgba(245,158,11,0.08)]",
        className
      )}
    >
      {/* Top accent bar */}
      <div
        className={cn(
          "h-1 w-full",
          isEnforceMode
            ? "bg-gradient-to-r from-red-500 via-orange-500 to-red-500"
            : "bg-gradient-to-r from-amber-500 via-yellow-500 to-amber-500"
        )}
      />

      <CardHeader className="pb-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            {/* Animated icon container */}
            <div className="relative">
              <div
                className={cn(
                  "absolute inset-0 rounded-xl blur-lg opacity-60",
                  isEnforceMode ? "bg-red-500/30" : "bg-amber-500/30"
                )}
              />
              <div
                className={cn(
                  "relative p-3 rounded-xl border transition-all duration-300",
                  isEnforceMode
                    ? "bg-red-500/10 border-red-500/20"
                    : "bg-amber-500/10 border-amber-500/20"
                )}
              >
                {isEnforceMode ? (
                  <ShieldAlert className="h-6 w-6 text-red-400" />
                ) : (
                  <Shield className="h-6 w-6 text-amber-400" />
                )}
              </div>
            </div>
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                Airlock Security
                <Badge
                  variant="outline"
                  className={cn(
                    "ml-1 text-[10px] font-bold uppercase tracking-wider",
                    isEnforceMode
                      ? "bg-red-500/10 text-red-400 border-red-500/30"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                  )}
                >
                  {isEnforceMode ? "Active" : "Monitoring"}
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1">
                Runtime Application Self-Protection for AI Agents
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Mode Toggle - Featured Section */}
        <div
          className={cn(
            "relative p-5 rounded-xl border-2 transition-all duration-300",
            isEnforceMode
              ? "bg-gradient-to-br from-red-500/5 to-orange-500/5 border-red-500/20"
              : "bg-gradient-to-br from-amber-500/5 to-yellow-500/5 border-amber-500/20"
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  "p-2.5 rounded-lg",
                  isEnforceMode ? "bg-red-500/10" : "bg-amber-500/10"
                )}
              >
                <Lock
                  className={cn(
                    "h-5 w-5",
                    isEnforceMode ? "text-red-400" : "text-amber-400"
                  )}
                />
              </div>
              <div>
                <Label className="text-base font-semibold">
                  {isEnforceMode ? "Enforce Mode" : "Shadow Mode"}
                </Label>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {isEnforceMode
                    ? "Violations will block tool execution"
                    : "Violations are logged but not blocked"}
                </p>
              </div>
            </div>
            <Switch
              checked={isEnforceMode}
              onCheckedChange={handleToggleMode}
              disabled={toggleMode.isPending}
              className="scale-110"
            />
          </div>
        </div>

        <Separator className="bg-border/50" />

        {/* RCE Detection Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-purple-500/10">
              <Zap className="h-4 w-4 text-purple-400" />
            </div>
            <h4 className="font-semibold text-foreground">RCE Pattern Detection</h4>
          </div>

          <div className="ml-8 p-4 rounded-lg bg-secondary/30 border border-border/50">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-sm">Enable Detection</Label>
                <p className="text-xs text-muted-foreground">
                  Detect code injection and RCE patterns in tool inputs
                </p>
              </div>
              <Switch
                checked={effectiveConfig.rce_detection_enabled ?? true}
                onCheckedChange={(checked) =>
                  updateLocalConfig("rce_detection_enabled", checked)
                }
              />
            </div>
          </div>
        </div>

        <Separator className="bg-border/50" />

        {/* Velocity Limits Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-cyan-500/10">
              <Activity className="h-4 w-4 text-cyan-400" />
            </div>
            <h4 className="font-semibold text-foreground">Financial Circuit Breaker</h4>
          </div>

          <div className="ml-8 space-y-4">
            <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="space-y-1">
                <Label className="text-sm">Velocity Tracking</Label>
                <p className="text-xs text-muted-foreground">
                  Monitor spending velocity and loop detection
                </p>
              </div>
              <Switch
                checked={effectiveConfig.velocity_tracking_enabled ?? true}
                onCheckedChange={(checked) =>
                  updateLocalConfig("velocity_tracking_enabled", checked)
                }
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="velocity-cost" className="text-xs text-muted-foreground">
                  Max Cost (cents)
                </Label>
                <Input
                  id="velocity-cost"
                  type="number"
                  value={effectiveConfig.max_cost_cents_per_window ?? 100}
                  onChange={(e) =>
                    updateLocalConfig(
                      "max_cost_cents_per_window",
                      parseInt(e.target.value, 10)
                    )
                  }
                  className="h-9 bg-background/50"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="velocity-window" className="text-xs text-muted-foreground">
                  Window (sec)
                </Label>
                <Input
                  id="velocity-window"
                  type="number"
                  value={effectiveConfig.velocity_window_seconds ?? 10}
                  onChange={(e) =>
                    updateLocalConfig(
                      "velocity_window_seconds",
                      parseInt(e.target.value, 10)
                    )
                  }
                  className="h-9 bg-background/50"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="loop-threshold" className="text-xs text-muted-foreground">
                  Loop Limit
                </Label>
                <Input
                  id="loop-threshold"
                  type="number"
                  value={effectiveConfig.loop_threshold ?? 3}
                  onChange={(e) =>
                    updateLocalConfig("loop_threshold", parseInt(e.target.value, 10))
                  }
                  className="h-9 bg-background/50"
                />
              </div>
            </div>
          </div>
        </div>

        <Separator className="bg-border/50" />

        {/* Exfiltration Shield Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-emerald-500/10">
              <Globe className="h-4 w-4 text-emerald-400" />
            </div>
            <h4 className="font-semibold text-foreground">Data Exfiltration Shield</h4>
          </div>

          <div className="ml-8 space-y-3">
            <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="space-y-1">
                <Label className="text-sm">Enable Shield</Label>
                <p className="text-xs text-muted-foreground">
                  Monitor network tools for unauthorized data exfiltration
                </p>
              </div>
              <Switch
                checked={effectiveConfig.exfiltration_shield_enabled ?? true}
                onCheckedChange={(checked) =>
                  updateLocalConfig("exfiltration_shield_enabled", checked)
                }
              />
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="space-y-1">
                <Label className="text-sm">Block Raw IP Addresses</Label>
                <p className="text-xs text-muted-foreground">
                  Prevent connections to raw IP addresses
                </p>
              </div>
              <Switch
                checked={effectiveConfig.block_ip_addresses ?? true}
                onCheckedChange={(checked) =>
                  updateLocalConfig("block_ip_addresses", checked)
                }
              />
            </div>
          </div>
        </div>

        {/* Save Button */}
        {hasChanges && (
          <div className="pt-4 border-t border-border/50">
            <Button
              onClick={handleSave}
              disabled={updateConfig.isPending}
              className={cn(
                "w-full gap-2 font-medium",
                "bg-gradient-to-r from-accent-primary to-cyan-500",
                "hover:from-accent-primary/90 hover:to-cyan-500/90",
                "shadow-lg shadow-accent-primary/20"
              )}
            >
              {updateConfig.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Changes
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
