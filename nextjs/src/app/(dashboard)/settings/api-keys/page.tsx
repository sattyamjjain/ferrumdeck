"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Key,
  Copy,
  Trash2,
  Eye,
  EyeOff,
  Check,
  RefreshCw,
  AlertCircle,
  Shield,
  Clock,
  Calendar,
  Activity,
  Lock,
} from "lucide-react";
import { toast } from "sonner";
import { LoadingSpinner, SkeletonRow } from "@/components/shared/loading-spinner";
import { EmptyState } from "@/components/shared/empty-state";
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  getStatusInfo,
  getScopeInfo,
  ALL_SCOPES,
  SCOPE_PRESETS,
  type ApiKeyScope,
  type ApiKeyInfo,
} from "@/hooks/use-api-keys";

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelativeTime(dateString?: string): string {
  if (!dateString) return "Never";

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return formatDate(dateString);
}

export default function ApiKeysPage() {
  // Hydration fix - ensure client-only rendering for Radix components
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<ApiKeyScope[]>([]);
  const [expiresInDays, setExpiresInDays] = useState<string>("90");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKeyInfo | null>(null);

  const { data, isLoading, error, refetch } = useApiKeys();
  const createMutation = useCreateApiKey();
  const revokeMutation = useRevokeApiKey();

  const handlePresetSelect = (preset: keyof typeof SCOPE_PRESETS) => {
    setSelectedScopes(SCOPE_PRESETS[preset]);
  };

  const toggleScope = (scope: ApiKeyScope) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const handleCreateKey = async () => {
    try {
      const result = await createMutation.mutateAsync({
        name: newKeyName,
        scopes: selectedScopes,
        expires_in_days: expiresInDays ? parseInt(expiresInDays) : undefined,
      });
      setGeneratedKey(result.key);
      toast.success("API key created successfully");
    } catch {
      toast.error("Failed to create API key");
    }
  };

  const handleCopyKey = () => {
    if (generatedKey) {
      navigator.clipboard.writeText(generatedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("API key copied to clipboard");
    }
  };

  const handleRevokeKey = async () => {
    if (!keyToRevoke) return;

    try {
      await revokeMutation.mutateAsync({ keyId: keyToRevoke.id });
      toast.success(`API key "${keyToRevoke.name}" revoked`);
      setKeyToRevoke(null);
    } catch {
      toast.error("Failed to revoke API key");
    }
  };

  const handleDialogClose = () => {
    setIsCreateDialogOpen(false);
    setNewKeyName("");
    setSelectedScopes([]);
    setExpiresInDays("90");
    setGeneratedKey(null);
    setShowKey(false);
  };

  const keys = data?.keys || [];
  const activeKeys = keys.filter((k) => k.status === "active");

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Page header with gradient accent */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-amber-500/5 via-transparent to-transparent rounded-xl -z-10" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 pb-2">
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <Key className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">API Keys</h1>
              <p className="text-sm text-muted-foreground">
                Manage API keys for authenticating with the FerrumDeck API
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            {mounted && (
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-amber-600 hover:bg-amber-700">
                <Plus className="h-4 w-4" />
                Create API Key
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Key className="h-5 w-5 text-amber-400" />
                  Create API Key
                </DialogTitle>
                <DialogDescription>
                  Create a new API key for accessing the FerrumDeck API.
                  Make sure to copy the key as it will only be shown once.
                </DialogDescription>
              </DialogHeader>
              {!generatedKey ? (
                <>
                  <div className="space-y-4 py-4">
                    {/* Key Name */}
                    <div className="space-y-2">
                      <Label htmlFor="name">Key Name</Label>
                      <Input
                        id="name"
                        placeholder="e.g., Development Key"
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        className="bg-slate-900/50 border-slate-700"
                      />
                      <p className="text-xs text-muted-foreground">
                        A friendly name to identify this key
                      </p>
                    </div>

                    {/* Expiration */}
                    <div className="space-y-2">
                      <Label>Expiration</Label>
                      <Select value={expiresInDays} onValueChange={setExpiresInDays}>
                        <SelectTrigger className="bg-slate-900/50 border-slate-700">
                          <SelectValue placeholder="Select expiration" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="30">30 days</SelectItem>
                          <SelectItem value="60">60 days</SelectItem>
                          <SelectItem value="90">90 days</SelectItem>
                          <SelectItem value="180">180 days</SelectItem>
                          <SelectItem value="365">1 year</SelectItem>
                          <SelectItem value="">Never expires</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Scope Presets */}
                    <div className="space-y-2">
                      <Label>Permission Presets</Label>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handlePresetSelect("readOnly")}
                          className={
                            JSON.stringify(selectedScopes.sort()) ===
                            JSON.stringify(SCOPE_PRESETS.readOnly.sort())
                              ? "border-amber-500 text-amber-400"
                              : ""
                          }
                        >
                          Read Only
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handlePresetSelect("runExecutor")}
                          className={
                            JSON.stringify(selectedScopes.sort()) ===
                            JSON.stringify(SCOPE_PRESETS.runExecutor.sort())
                              ? "border-amber-500 text-amber-400"
                              : ""
                          }
                        >
                          Run Executor
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handlePresetSelect("fullAccess")}
                          className={
                            selectedScopes.length === ALL_SCOPES.length
                              ? "border-amber-500 text-amber-400"
                              : ""
                          }
                        >
                          Full Access
                        </Button>
                      </div>
                    </div>

                    {/* Custom Scopes */}
                    <div className="space-y-2">
                      <Label>Permissions</Label>
                      <div className="grid grid-cols-2 gap-2 p-3 rounded-lg border border-slate-700 bg-slate-900/30 max-h-[200px] overflow-y-auto">
                        {ALL_SCOPES.map((scope) => {
                          const info = getScopeInfo(scope);
                          return (
                            <div
                              key={scope}
                              className="flex items-center space-x-2"
                            >
                              <Checkbox
                                id={scope}
                                checked={selectedScopes.includes(scope)}
                                onCheckedChange={() => toggleScope(scope)}
                              />
                              <label
                                htmlFor={scope}
                                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                              >
                                {info.label}
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={handleDialogClose}>
                      Cancel
                    </Button>
                    <Button
                      onClick={handleCreateKey}
                      disabled={!newKeyName || selectedScopes.length === 0 || createMutation.isPending}
                      className="bg-amber-600 hover:bg-amber-700"
                    >
                      {createMutation.isPending ? (
                        <LoadingSpinner size="sm" />
                      ) : (
                        "Generate Key"
                      )}
                    </Button>
                  </DialogFooter>
                </>
              ) : (
                <div className="space-y-4 py-4">
                  <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-5 w-5 text-amber-400 mt-0.5" />
                      <p className="text-sm text-amber-400">
                        Make sure to copy your API key now. You will not be able to see it again!
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Your API Key</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          readOnly
                          type={showKey ? "text" : "password"}
                          value={generatedKey}
                          className="font-mono pr-10 bg-slate-900/50 border-slate-700"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full"
                          onClick={() => setShowKey(!showKey)}
                        >
                          {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                      <Button variant="outline" onClick={handleCopyKey}>
                        {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={handleDialogClose} className="w-full">
                      Done
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </DialogContent>
          </Dialog>
            )}
        </div>
      </div>
    </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Key className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Keys</p>
                <p className="text-2xl font-semibold">{keys.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <Shield className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active Keys</p>
                <p className="text-2xl font-semibold">{activeKeys.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Activity className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Recently Used</p>
                <p className="text-2xl font-semibold">
                  {activeKeys.filter((k) => k.last_used_at).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Keys Table */}
      <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className="h-5 w-5 text-amber-400" />
              <CardTitle>API Keys</CardTitle>
            </div>
            <CardDescription>
              {isLoading
                ? "Loading keys..."
                : `${keys.length} API ${keys.length === 1 ? "key" : "keys"} configured`}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </div>
          ) : error ? (
            <EmptyState
              icon={AlertCircle}
              title="Failed to load API keys"
              description="There was an error fetching the API keys. Please try again."
              action={
                <Button onClick={() => refetch()} variant="outline">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
              }
            />
          ) : keys.length === 0 ? (
            <EmptyState
              icon={Key}
              title="No API keys yet"
              description="Create your first API key to start using the FerrumDeck API."
              action={
                <Button
                  onClick={() => setIsCreateDialogOpen(true)}
                  className="bg-amber-600 hover:bg-amber-700"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create API Key
                </Button>
              }
            />
          ) : (
            <div className="rounded-lg border border-slate-700/50 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-slate-700/50">
                    <TableHead className="text-slate-400">Name</TableHead>
                    <TableHead className="text-slate-400">Key Prefix</TableHead>
                    <TableHead className="text-slate-400">Scopes</TableHead>
                    <TableHead className="text-slate-400">Created</TableHead>
                    <TableHead className="text-slate-400">Last Used</TableHead>
                    <TableHead className="text-slate-400">Expires</TableHead>
                    <TableHead className="text-slate-400">Status</TableHead>
                    <TableHead className="text-right text-slate-400">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((key, index) => {
                    const statusInfo = getStatusInfo(key.status);
                    return (
                      <TableRow
                        key={key.id}
                        className="hover:bg-slate-800/50 border-slate-700/50 animate-fade-in"
                        style={{ animationDelay: `${index * 50}ms` }}
                      >
                        <TableCell className="font-medium">{key.name}</TableCell>
                        <TableCell>
                          <code className="rounded bg-slate-800 px-2 py-1 text-sm text-slate-300">
                            {key.key_prefix}...
                          </code>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {key.scopes.slice(0, 2).map((scope) => (
                              <Badge
                                key={scope}
                                variant="outline"
                                className="text-xs bg-slate-800/50"
                              >
                                {getScopeInfo(scope).label}
                              </Badge>
                            ))}
                            {key.scopes.length > 2 && (
                              <Badge
                                variant="outline"
                                className="text-xs bg-slate-800/50"
                              >
                                +{key.scopes.length - 2}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5" />
                            {formatDate(key.created_at)}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <div className="flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5" />
                            {formatRelativeTime(key.last_used_at)}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {key.expires_at ? formatDate(key.expires_at) : "Never"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusInfo.color}>
                            {statusInfo.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {key.status === "active" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                              onClick={() => setKeyToRevoke(key)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revoke Confirmation Dialog */}
      {mounted && (
        <AlertDialog open={!!keyToRevoke} onOpenChange={() => setKeyToRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-400" />
              Revoke API Key
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to revoke &quot;{keyToRevoke?.name}&quot;? This action
              cannot be undone and any applications using this key will stop working
              immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevokeKey}
              className="bg-red-600 hover:bg-red-700"
              disabled={revokeMutation.isPending}
            >
              {revokeMutation.isPending ? <LoadingSpinner size="sm" /> : "Revoke Key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      )}

      {/* Usage Guidelines */}
      <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-slate-400" />
            Usage Guidelines
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-slate-700/50 p-4 bg-slate-900/30">
            <h4 className="font-medium mb-2 text-slate-200">Authentication</h4>
            <p className="text-sm text-muted-foreground mb-3">
              Include your API key in the Authorization header:
            </p>
            <pre className="rounded bg-slate-950 p-3 text-sm overflow-x-auto border border-slate-700/50">
              <code className="text-emerald-400">Authorization: Bearer fd_your_api_key_here</code>
            </pre>
          </div>
          <div className="rounded-lg border border-slate-700/50 p-4 bg-slate-900/30">
            <h4 className="font-medium mb-2 text-slate-200">Security Best Practices</h4>
            <ul className="text-sm text-muted-foreground space-y-2">
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Never commit API keys to version control
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Use environment variables to store keys
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Rotate keys regularly (recommended: every 90 days)
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Use separate keys for development and production
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Apply least-privilege principle when selecting scopes
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
