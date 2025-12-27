"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface JsonViewerProps {
  data: unknown;
  collapsed?: boolean;
  className?: string;
}

export function JsonViewer({ data, collapsed = false, className }: JsonViewerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("relative group", className)}>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={handleCopy}
      >
        {copied ? (
          <Check className="h-3 w-3 text-green-400" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </Button>
      <pre className="bg-background-tertiary rounded-md p-3 text-xs overflow-auto max-h-64">
        <JsonNode data={data} collapsed={collapsed} depth={0} />
      </pre>
    </div>
  );
}

interface JsonNodeProps {
  data: unknown;
  collapsed?: boolean;
  depth: number;
}

function JsonNode({ data, collapsed, depth }: JsonNodeProps) {
  const [isCollapsed, setIsCollapsed] = useState(collapsed && depth > 0);

  if (data === null) return <span className="text-muted-foreground">null</span>;
  if (data === undefined) return <span className="text-muted-foreground">undefined</span>;

  if (typeof data === "string") {
    return <span className="text-green-400">&quot;{data}&quot;</span>;
  }

  if (typeof data === "number") {
    return <span className="text-yellow-400">{data}</span>;
  }

  if (typeof data === "boolean") {
    return <span className="text-purple-400">{data.toString()}</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return <span>[]</span>;

    if (isCollapsed) {
      return (
        <span
          className="cursor-pointer hover:text-primary"
          onClick={() => setIsCollapsed(false)}
        >
          <ChevronRight className="inline h-3 w-3" />
          <span className="text-muted-foreground">Array({data.length})</span>
        </span>
      );
    }

    return (
      <span>
        <span
          className="cursor-pointer hover:text-primary"
          onClick={() => setIsCollapsed(true)}
        >
          <ChevronDown className="inline h-3 w-3" />
        </span>
        {"[\n"}
        {data.map((item, index) => (
          <span key={index} style={{ marginLeft: (depth + 1) * 16 }}>
            {"  ".repeat(depth + 1)}
            <JsonNode data={item} collapsed={collapsed} depth={depth + 1} />
            {index < data.length - 1 ? "," : ""}
            {"\n"}
          </span>
        ))}
        {"  ".repeat(depth)}]
      </span>
    );
  }

  if (typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return <span>{"{}"}</span>;

    if (isCollapsed) {
      return (
        <span
          className="cursor-pointer hover:text-primary"
          onClick={() => setIsCollapsed(false)}
        >
          <ChevronRight className="inline h-3 w-3" />
          <span className="text-muted-foreground">{"{"}{entries.length} keys{"}"}</span>
        </span>
      );
    }

    return (
      <span>
        <span
          className="cursor-pointer hover:text-primary"
          onClick={() => setIsCollapsed(true)}
        >
          <ChevronDown className="inline h-3 w-3" />
        </span>
        {"{\n"}
        {entries.map(([key, value], index) => (
          <span key={key}>
            {"  ".repeat(depth + 1)}
            <span className="text-blue-400">&quot;{key}&quot;</span>
            {": "}
            <JsonNode data={value} collapsed={collapsed} depth={depth + 1} />
            {index < entries.length - 1 ? "," : ""}
            {"\n"}
          </span>
        ))}
        {"  ".repeat(depth)}{"}"}
      </span>
    );
  }

  return <span>{String(data)}</span>;
}
