"use client";

import { useState, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileJson,
  ArrowLeftRight,
  Plus,
  Minus,
  Edit3,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { JsonViewer } from "@/components/shared/json-viewer";
import { cn, formatTimeAgo } from "@/lib/utils";
import type { ToolVersion, SchemaDiff } from "@/types/tool";

interface ToolSchemaViewerProps {
  currentVersion: ToolVersion | undefined;
  versions: ToolVersion[];
  isLoading?: boolean;
}

export function ToolSchemaViewer({ currentVersion, versions, isLoading }: ToolSchemaViewerProps) {
  const [showDiff, setShowDiff] = useState(false);
  const [compareVersion, setCompareVersion] = useState<string | null>(null);

  // Get version to compare with
  const comparisonVersion = useMemo(() => {
    if (!compareVersion) return null;
    return versions.find((v) => v.id === compareVersion) || null;
  }, [compareVersion, versions]);

  // Compute schema diff
  const schemaDiff = useMemo<SchemaDiff | null>(() => {
    if (!currentVersion || !comparisonVersion) return null;

    const currentKeys = getSchemaKeys(currentVersion.input_schema);
    const compareKeys = getSchemaKeys(comparisonVersion.input_schema);

    const added = currentKeys.filter((k) => !compareKeys.includes(k));
    const removed = compareKeys.filter((k) => !currentKeys.includes(k));
    const unchanged = currentKeys.filter((k) => compareKeys.includes(k));

    // Check for modified (same key, different value)
    const modified = unchanged.filter((key) => {
      const currentVal = JSON.stringify(getNestedValue(currentVersion.input_schema, key));
      const compareVal = JSON.stringify(getNestedValue(comparisonVersion.input_schema, key));
      return currentVal !== compareVal;
    });

    return {
      added,
      removed,
      modified,
      unchanged: unchanged.filter((k) => !modified.includes(k)),
    };
  }, [currentVersion, comparisonVersion]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center">
            <div className="animate-pulse text-muted-foreground">Loading schema...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!currentVersion) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">
            <FileJson className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No schema available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current Schema */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">Input Schema</CardTitle>
              <CardDescription>
                Version {currentVersion.version} - {formatTimeAgo(currentVersion.created_at)}
              </CardDescription>
            </div>
            {versions.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDiff(!showDiff)}
                className={cn(showDiff && "bg-accent-blue/10 border-accent-blue/30")}
              >
                <ArrowLeftRight className="h-4 w-4 mr-2" />
                Compare
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <JsonViewer
            data={currentVersion.input_schema}
            collapsed={1}
            searchable
            showLineNumbers
            maxHeight={400}
          />
        </CardContent>
      </Card>

      {/* Output Schema (if available) */}
      {currentVersion.output_schema && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Output Schema</CardTitle>
            <CardDescription>Expected response format</CardDescription>
          </CardHeader>
          <CardContent>
            <JsonViewer
              data={currentVersion.output_schema}
              collapsed={1}
              searchable
              showLineNumbers
              maxHeight={300}
            />
          </CardContent>
        </Card>
      )}

      {/* Version Comparison */}
      {showDiff && versions.length > 1 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm">Version Comparison</CardTitle>
                <CardDescription>
                  Compare current version with a previous version
                </CardDescription>
              </div>
              <Select
                value={compareVersion || ""}
                onValueChange={setCompareVersion}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select version" />
                </SelectTrigger>
                <SelectContent>
                  {versions
                    .filter((v) => v.id !== currentVersion.id)
                    .map((version) => (
                      <SelectItem key={version.id} value={version.id}>
                        v{version.version} - {formatTimeAgo(version.created_at)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {schemaDiff ? (
              <div className="space-y-4">
                {/* Diff Summary */}
                <div className="flex items-center gap-4 p-3 rounded-lg bg-background-secondary">
                  <div className="flex items-center gap-1.5">
                    <Plus className="h-4 w-4 text-accent-green" />
                    <span className="text-sm">
                      <strong>{schemaDiff.added.length}</strong> added
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Minus className="h-4 w-4 text-accent-red" />
                    <span className="text-sm">
                      <strong>{schemaDiff.removed.length}</strong> removed
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Edit3 className="h-4 w-4 text-accent-yellow" />
                    <span className="text-sm">
                      <strong>{schemaDiff.modified.length}</strong> modified
                    </span>
                  </div>
                </div>

                {/* Detailed Changes */}
                {(schemaDiff.added.length > 0 ||
                  schemaDiff.removed.length > 0 ||
                  schemaDiff.modified.length > 0) && (
                  <div className="space-y-3">
                    {schemaDiff.added.length > 0 && (
                      <DiffSection
                        title="Added"
                        items={schemaDiff.added}
                        icon={Plus}
                        className="text-accent-green bg-accent-green/10 border-accent-green/20"
                      />
                    )}
                    {schemaDiff.removed.length > 0 && (
                      <DiffSection
                        title="Removed"
                        items={schemaDiff.removed}
                        icon={Minus}
                        className="text-accent-red bg-accent-red/10 border-accent-red/20"
                      />
                    )}
                    {schemaDiff.modified.length > 0 && (
                      <DiffSection
                        title="Modified"
                        items={schemaDiff.modified}
                        icon={Edit3}
                        className="text-accent-yellow bg-accent-yellow/10 border-accent-yellow/20"
                      />
                    )}
                  </div>
                )}

                {schemaDiff.added.length === 0 &&
                  schemaDiff.removed.length === 0 &&
                  schemaDiff.modified.length === 0 && (
                    <div className="text-center py-4 text-sm text-muted-foreground">
                      No differences found between versions
                    </div>
                  )}
              </div>
            ) : (
              <div className="text-center py-4 text-sm text-muted-foreground">
                Select a version to compare
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Changelog */}
      {currentVersion.changelog && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Changelog</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {currentVersion.changelog}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Diff Section Component
interface DiffSectionProps {
  title: string;
  items: string[];
  icon: typeof Plus;
  className: string;
}

function DiffSection({ title, items, icon: Icon, className }: DiffSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className={cn("rounded-lg border p-3", className)}>
      <button
        className="flex items-center gap-2 w-full text-left"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        <Icon className="h-4 w-4" />
        <span className="text-sm font-medium">{title}</span>
        <Badge variant="secondary" className="ml-auto text-xs">
          {items.length}
        </Badge>
      </button>
      {isExpanded && (
        <div className="mt-2 pl-6 space-y-1">
          {items.map((item) => (
            <div key={item} className="font-mono text-xs">
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Helper function to get all keys from a schema object (nested)
function getSchemaKeys(obj: Record<string, unknown>, prefix: string = ""): string[] {
  const keys: string[] = [];

  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    keys.push(fullKey);

    const value = obj[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...getSchemaKeys(value as Record<string, unknown>, fullKey));
    }
  }

  return keys;
}

// Helper function to get nested value from object
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;

  for (const key of keys) {
    if (current && typeof current === "object" && key in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }

  return current;
}
