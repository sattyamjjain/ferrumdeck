"use client";

import { useState, Suspense } from "react";
import dynamic from "next/dynamic";
import { Settings, Key, Copy, Check, Eye, EyeOff, Trash2, Plus, RefreshCw, AlertTriangle, RotateCcw, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AirlockSettingsCard } from "@/components/security";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Dynamic import for Select to avoid hydration mismatch
const DynamicSelect = dynamic(
  () => import("@/components/ui/select").then(mod => ({
    default: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: React.ReactNode }) => (
      <mod.Select value={value} onValueChange={onValueChange}>
        {children}
      </mod.Select>
    )
  })),
  {
    ssr: false,
    loading: () => <Skeleton className="h-10 w-48" />
  }
);

const SelectTrigger = dynamic(() => import("@/components/ui/select").then(mod => mod.SelectTrigger), { ssr: false });
const SelectContent = dynamic(() => import("@/components/ui/select").then(mod => mod.SelectContent), { ssr: false });
const SelectItem = dynamic(() => import("@/components/ui/select").then(mod => mod.SelectItem), { ssr: false });
const SelectValue = dynamic(() => import("@/components/ui/select").then(mod => mod.SelectValue), { ssr: false });

export default function SettingsPage() {
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [apiKey] = useState("fd_live_key_*********************");
  const [refreshInterval, setRefreshInterval] = useState("2000");
  const [notifications, setNotifications] = useState(true);
  const [autoApprove, setAutoApprove] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const handleCopyKey = () => {
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    toast.success("API key copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerateKey = () => {
    toast.success("API key regenerated");
  };

  const handleDeleteAll = () => {
    if (deleteConfirm.toLowerCase() === "delete") {
      toast.success("All runs have been deleted");
      setDeleteConfirm("");
    }
  };

  const handleReset = () => {
    toast.success("Configuration has been reset");
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl animate-fade-in">
      {/* Page header with gradient accent */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-slate-500/5 via-transparent to-transparent rounded-xl -z-10" />
        <div className="flex items-center gap-3 pb-2">
          <div className="p-2.5 rounded-xl bg-slate-500/10 border border-slate-500/20">
            <Settings className="h-5 w-5 text-slate-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Configure your dashboard preferences and API access
            </p>
          </div>
        </div>
      </div>

      {/* API Key Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            API Key
          </CardTitle>
          <CardDescription>
            Use this key to authenticate API requests to the control plane
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Input
                type={showKey ? "text" : "password"}
                value={apiKey}
                readOnly
                className="pr-20 font-mono text-sm"
              />
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-8 top-0 h-full"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full"
                onClick={handleCopyKey}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-400" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleRegenerateKey}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Regenerate
            </Button>
            <Button variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Create New Key
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Dashboard Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Dashboard Preferences
          </CardTitle>
          <CardDescription>
            Customize your dashboard experience
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Refresh Interval</Label>
            <Suspense fallback={<Skeleton className="h-10 w-48" />}>
              <DynamicSelect value={refreshInterval} onValueChange={setRefreshInterval}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1000">1 second</SelectItem>
                  <SelectItem value="2000">2 seconds</SelectItem>
                  <SelectItem value="5000">5 seconds</SelectItem>
                  <SelectItem value="10000">10 seconds</SelectItem>
                  <SelectItem value="30000">30 seconds</SelectItem>
                </SelectContent>
              </DynamicSelect>
            </Suspense>
            <p className="text-xs text-muted-foreground">
              How often to poll for updates
            </p>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Notifications</Label>
              <p className="text-xs text-muted-foreground">
                Show toast notifications for new approvals
              </p>
            </div>
            <Switch
              checked={notifications}
              onCheckedChange={setNotifications}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Auto-approve Low Risk</Label>
              <p className="text-xs text-muted-foreground">
                Automatically approve read-only tool calls
              </p>
            </div>
            <Switch
              checked={autoApprove}
              onCheckedChange={setAutoApprove}
            />
          </div>
        </CardContent>
      </Card>

      {/* Airlock Security Settings */}
      <AirlockSettingsCard />

      {/* Danger Zone - Enhanced with warning styling */}
      <div className="relative">
        {/* Warning glow effect */}
        <div className="absolute -inset-1 bg-gradient-to-r from-red-500/10 via-red-500/5 to-transparent rounded-2xl blur-xl" />

        <Card className={cn(
          "relative overflow-hidden",
          "border-red-500/30 bg-gradient-to-b from-red-500/5 to-transparent",
          "shadow-[0_0_30px_rgba(239,68,68,0.1)]"
        )}>
          {/* Top warning stripe */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-500/60 via-red-500/80 to-red-500/60" />

          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/15 border border-red-500/25">
                <ShieldAlert className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <CardTitle className="text-red-400 flex items-center gap-2">
                  Danger Zone
                </CardTitle>
                <CardDescription className="text-red-400/60">
                  These actions are permanent and cannot be undone
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Delete All Runs */}
            <div className={cn(
              "flex items-center justify-between gap-4 p-4 rounded-lg",
              "bg-red-500/5 border border-red-500/20",
              "hover:bg-red-500/10 hover:border-red-500/30 transition-colors"
            )}>
              <div className="flex items-start gap-3">
                <Trash2 className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-red-300">Delete All Runs</p>
                  <p className="text-xs text-muted-foreground">
                    Permanently delete all run history and audit logs. This action cannot be reversed.
                  </p>
                </div>
              </div>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="shrink-0 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30"
                  >
                    Delete All
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="border-red-500/30 bg-background">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2 text-red-400">
                      <AlertTriangle className="h-5 w-5" />
                      Delete All Runs?
                    </AlertDialogTitle>
                    <AlertDialogDescription className="space-y-3">
                      <p>This will permanently delete:</p>
                      <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                        <li>All run history and execution logs</li>
                        <li>All audit trail records</li>
                        <li>All associated metrics and analytics</li>
                      </ul>
                      <p className="text-red-400/80 font-medium">
                        This action cannot be undone.
                      </p>
                      <div className="pt-2">
                        <Label htmlFor="confirm-delete" className="text-xs">
                          Type <span className="font-mono text-red-400">DELETE</span> to confirm
                        </Label>
                        <Input
                          id="confirm-delete"
                          value={deleteConfirm}
                          onChange={(e) => setDeleteConfirm(e.target.value)}
                          placeholder="DELETE"
                          className="mt-2 font-mono border-red-500/30 focus:border-red-500"
                        />
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setDeleteConfirm("")}>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteAll}
                      disabled={deleteConfirm.toLowerCase() !== "delete"}
                      className="bg-red-500 hover:bg-red-600 disabled:opacity-50"
                    >
                      Delete All Runs
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            {/* Reset Configuration */}
            <div className={cn(
              "flex items-center justify-between gap-4 p-4 rounded-lg",
              "bg-red-500/5 border border-red-500/20",
              "hover:bg-red-500/10 hover:border-red-500/30 transition-colors"
            )}>
              <div className="flex items-start gap-3">
                <RotateCcw className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-red-300">Reset Configuration</p>
                  <p className="text-xs text-muted-foreground">
                    Reset all agents, tools, and policies to their default configuration.
                  </p>
                </div>
              </div>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="shrink-0 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30"
                  >
                    Reset
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="border-red-500/30 bg-background">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2 text-red-400">
                      <AlertTriangle className="h-5 w-5" />
                      Reset Configuration?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      <p>This will reset all configurations to their default values:</p>
                      <ul className="list-disc list-inside text-sm space-y-1 mt-3 text-muted-foreground">
                        <li>All agent configurations</li>
                        <li>All tool definitions</li>
                        <li>All policy rules</li>
                      </ul>
                      <p className="text-red-400/80 font-medium mt-3">
                        This action cannot be undone.
                      </p>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleReset}
                      className="bg-red-500 hover:bg-red-600"
                    >
                      Reset Configuration
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
