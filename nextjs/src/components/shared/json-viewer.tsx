"use client";

import {
  useCallback,
  useMemo,
  useState,
  useRef,
  memo,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Search,
  ChevronsUpDown,
  ChevronsDownUp,
  Eye,
  EyeOff,
  MoreHorizontal,
  ClipboardCopy,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ============================================================================
// Types
// ============================================================================

interface JsonViewerProps {
  data: unknown;
  collapsed?: boolean | number;
  searchable?: boolean;
  redactedPaths?: string[];
  canReveal?: boolean;
  maxHeight?: number;
  showLineNumbers?: boolean;
  onCopyPath?: (path: string) => void;
  onCopyValue?: (value: unknown) => void;
  className?: string;
}

interface FlattenedNode {
  id: string;
  path: string;
  key: string | number | null;
  value: unknown;
  depth: number;
  type: "object" | "array" | "primitive";
  isExpanded: boolean;
  isLastChild: boolean;
  childCount: number;
  isRedacted: boolean;
  searchMatch: boolean;
  parentPath: string;
}

type CollapsedState = Map<string, boolean>;
type RevealedState = Set<string>;

// ============================================================================
// Constants
// ============================================================================

const TRUNCATION_LIMIT = 100;
const INDENT_SIZE = 16;
const LINE_HEIGHT = 24;

// ============================================================================
// Utility Functions
// ============================================================================

function getValueType(value: unknown): "object" | "array" | "primitive" {
  if (value === null || value === undefined) return "primitive";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return "primitive";
}

function matchesRedactedPath(path: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Support simple wildcard matching
    const regex = new RegExp(
      "^" +
        pattern
          .replace(/\./g, "\\.")
          .replace(/\[\*\]/g, "\\[\\d+\\]")
          .replace(/\*\*/g, ".*")
          .replace(/\*/g, "[^.\\[\\]]*") +
        "$"
    );
    if (regex.test(path)) return true;
  }
  return false;
}

function stringifyValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function searchInValue(value: unknown, query: string): boolean {
  if (!query) return false;
  const lowerQuery = query.toLowerCase();
  const stringified = stringifyValue(value).toLowerCase();
  return stringified.includes(lowerQuery);
}

// ============================================================================
// Flattening Logic (for virtualization)
// ============================================================================

function flattenJson(
  data: unknown,
  collapsedState: CollapsedState,
  redactedPaths: string[],
  searchQuery: string,
  defaultCollapsed: boolean | number,
  parentPath: string = "$",
  depth: number = 0,
  key: string | number | null = null,
  isLastChild: boolean = true
): FlattenedNode[] {
  const nodes: FlattenedNode[] = [];
  const currentPath = key !== null ? `${parentPath}.${key}` : parentPath;
  const type = getValueType(data);
  const isRedacted = matchesRedactedPath(currentPath, redactedPaths);
  const searchMatch = searchQuery ? searchInValue(key, searchQuery) || searchInValue(data, searchQuery) : false;

  // Determine if this node should be collapsed
  let isExpanded = true;
  if (type !== "primitive") {
    const savedState = collapsedState.get(currentPath);
    if (savedState !== undefined) {
      isExpanded = !savedState;
    } else if (typeof defaultCollapsed === "number") {
      isExpanded = depth < defaultCollapsed;
    } else if (defaultCollapsed === true) {
      isExpanded = depth === 0;
    }
  }

  const childCount =
    type === "array"
      ? (data as unknown[]).length
      : type === "object"
      ? Object.keys(data as object).length
      : 0;

  nodes.push({
    id: currentPath,
    path: currentPath,
    key,
    value: data,
    depth,
    type,
    isExpanded,
    isLastChild,
    childCount,
    isRedacted,
    searchMatch,
    parentPath,
  });

  // If expanded and not redacted, add children
  if (isExpanded && !isRedacted && type !== "primitive") {
    if (type === "array") {
      const arr = data as unknown[];
      const displayCount = Math.min(arr.length, TRUNCATION_LIMIT);
      for (let i = 0; i < displayCount; i++) {
        nodes.push(
          ...flattenJson(
            arr[i],
            collapsedState,
            redactedPaths,
            searchQuery,
            defaultCollapsed,
            currentPath,
            depth + 1,
            i,
            i === displayCount - 1 && displayCount === arr.length
          )
        );
      }
      // Add "show more" indicator
      if (arr.length > TRUNCATION_LIMIT) {
        nodes.push({
          id: `${currentPath}.__truncated__`,
          path: `${currentPath}.__truncated__`,
          key: "__truncated__",
          value: { remaining: arr.length - TRUNCATION_LIMIT, total: arr.length },
          depth: depth + 1,
          type: "primitive",
          isExpanded: false,
          isLastChild: true,
          childCount: 0,
          isRedacted: false,
          searchMatch: false,
          parentPath: currentPath,
        });
      }
    } else if (type === "object") {
      const entries = Object.entries(data as Record<string, unknown>);
      const displayCount = Math.min(entries.length, TRUNCATION_LIMIT);
      for (let i = 0; i < displayCount; i++) {
        const [k, v] = entries[i];
        nodes.push(
          ...flattenJson(
            v,
            collapsedState,
            redactedPaths,
            searchQuery,
            defaultCollapsed,
            currentPath,
            depth + 1,
            k,
            i === displayCount - 1 && displayCount === entries.length
          )
        );
      }
      // Add "show more" indicator
      if (entries.length > TRUNCATION_LIMIT) {
        nodes.push({
          id: `${currentPath}.__truncated__`,
          path: `${currentPath}.__truncated__`,
          key: "__truncated__",
          value: { remaining: entries.length - TRUNCATION_LIMIT, total: entries.length },
          depth: depth + 1,
          type: "primitive",
          isExpanded: false,
          isLastChild: true,
          childCount: 0,
          isRedacted: false,
          searchMatch: false,
          parentPath: currentPath,
        });
      }
    }
  }

  return nodes;
}

// ============================================================================
// Value Renderer
// ============================================================================

interface ValueRendererProps {
  value: unknown;
  isRedacted: boolean;
  isRevealed: boolean;
  canReveal: boolean;
  onReveal: () => void;
  searchQuery: string;
  onCopyValue?: (value: unknown) => void;
}

const ValueRenderer = memo(function ValueRenderer({
  value,
  isRedacted,
  isRevealed,
  canReveal,
  onReveal,
  searchQuery,
  onCopyValue,
}: ValueRendererProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (onCopyValue) {
      onCopyValue(value);
    } else {
      navigator.clipboard.writeText(stringifyValue(value));
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [value, onCopyValue]);

  if (isRedacted && !isRevealed) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-accent-red/15 text-accent-red border border-accent-red/30">
          [REDACTED]
        </span>
        {canReveal && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={onReveal}
          >
            <Eye className="h-3 w-3 mr-0.5" />
            Reveal
          </Button>
        )}
      </span>
    );
  }

  const highlightText = (text: string) => {
    if (!searchQuery) return text;
    const lowerText = text.toLowerCase();
    const lowerQuery = searchQuery.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);
    if (index === -1) return text;
    return (
      <>
        {text.slice(0, index)}
        <mark className="bg-accent-yellow/40 text-accent-yellow rounded px-0.5">
          {text.slice(index, index + searchQuery.length)}
        </mark>
        {text.slice(index + searchQuery.length)}
      </>
    );
  };

  const renderValue = () => {
    if (value === null) {
      return <span className="text-foreground-muted italic">null</span>;
    }
    if (value === undefined) {
      return <span className="text-foreground-muted italic">undefined</span>;
    }
    if (typeof value === "string") {
      const displayText = value.length > 500 ? value.slice(0, 500) + "..." : value;
      return (
        <span className="text-accent-green">
          &quot;{highlightText(displayText)}&quot;
        </span>
      );
    }
    if (typeof value === "number") {
      return (
        <span className="text-accent-yellow">{highlightText(String(value))}</span>
      );
    }
    if (typeof value === "boolean") {
      return (
        <span className="text-accent-purple">{highlightText(String(value))}</span>
      );
    }
    return <span>{String(value)}</span>;
  };

  return (
    <span
      className="cursor-pointer hover:bg-background-tertiary rounded px-0.5 -mx-0.5 transition-colors group/value"
      onClick={handleCopy}
      title="Click to copy value"
    >
      {renderValue()}
      {copied && (
        <Check className="inline h-3 w-3 ml-1 text-accent-green" />
      )}
    </span>
  );
});

// ============================================================================
// Node Row Component
// ============================================================================

interface NodeRowProps {
  node: FlattenedNode;
  showLineNumbers: boolean;
  lineNumber: number;
  searchQuery: string;
  isRevealed: boolean;
  canReveal: boolean;
  truncatedPaths: Set<string>;
  onToggle: (path: string) => void;
  onReveal: (path: string) => void;
  onShowMore: (path: string) => void;
  onCopyPath?: (path: string) => void;
  onCopyValue?: (value: unknown) => void;
}

const NodeRow = memo(function NodeRow({
  node,
  showLineNumbers,
  lineNumber,
  searchQuery,
  isRevealed,
  canReveal,
  truncatedPaths,
  onToggle,
  onReveal,
  onShowMore,
  onCopyPath,
  onCopyValue,
}: NodeRowProps) {
  const [showContextMenu, setShowContextMenu] = useState(false);

  // Move hooks before any early returns
  const handleCopyPath = useCallback(() => {
    const jsonPath = node.path.replace(/^\$\.?/, "").replace(/\.(\d+)/g, "[$1]");
    if (onCopyPath) {
      onCopyPath(jsonPath || "$");
    } else {
      navigator.clipboard.writeText(jsonPath || "$");
    }
    setShowContextMenu(false);
  }, [node.path, onCopyPath]);

  const handleCopyValue = useCallback(() => {
    const stringified =
      node.type === "primitive"
        ? stringifyValue(node.value)
        : JSON.stringify(node.value, null, 2);
    if (onCopyValue) {
      onCopyValue(node.value);
    } else {
      navigator.clipboard.writeText(stringified);
    }
    setShowContextMenu(false);
  }, [node.value, node.type, onCopyValue]);

  // Handle truncated node
  if (node.key === "__truncated__") {
    const truncInfo = node.value as { remaining: number; total: number };
    const isShowingMore = truncatedPaths.has(node.parentPath);

    return (
      <div
        className="flex items-center h-6"
        style={{ paddingLeft: node.depth * INDENT_SIZE + (showLineNumbers ? 40 : 12) }}
      >
        {showLineNumbers && (
          <span className="absolute left-0 w-9 text-right pr-2 text-foreground-muted text-[11px] select-none">
            {lineNumber}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-2 text-[11px] text-accent-blue hover:text-accent-blue hover:bg-accent-blue/10"
          onClick={() => onShowMore(node.parentPath)}
        >
          {isShowingMore ? (
            <>Show less</>
          ) : (
            <>
              ... {truncInfo.remaining} more items (total: {truncInfo.total})
            </>
          )}
        </Button>
      </div>
    );
  }

  const renderToggle = () => {
    if (node.type === "primitive") {
      return <span className="w-4 inline-block" />;
    }
    return (
      <button
        className="w-4 h-4 inline-flex items-center justify-center text-foreground-muted hover:text-foreground transition-colors"
        onClick={() => onToggle(node.path)}
      >
        {node.isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </button>
    );
  };

  const renderKey = () => {
    if (node.key === null) return null;
    const keyStr = typeof node.key === "number" ? String(node.key) : `"${node.key}"`;
    const keyColor = typeof node.key === "number" ? "text-foreground-muted" : "text-accent-blue";

    const highlightKey = () => {
      if (!searchQuery) return keyStr;
      const lowerKey = keyStr.toLowerCase();
      const lowerQuery = searchQuery.toLowerCase();
      const index = lowerKey.indexOf(lowerQuery);
      if (index === -1) return keyStr;
      return (
        <>
          {keyStr.slice(0, index)}
          <mark className="bg-accent-yellow/40 text-accent-yellow rounded px-0.5">
            {keyStr.slice(index, index + searchQuery.length)}
          </mark>
          {keyStr.slice(index + searchQuery.length)}
        </>
      );
    };

    return (
      <>
        <span className={keyColor}>{highlightKey()}</span>
        <span className="text-foreground-muted">: </span>
      </>
    );
  };

  const renderBrackets = () => {
    if (node.type === "primitive") {
      return (
        <ValueRenderer
          value={node.value}
          isRedacted={node.isRedacted}
          isRevealed={isRevealed}
          canReveal={canReveal}
          onReveal={() => onReveal(node.path)}
          searchQuery={searchQuery}
          onCopyValue={onCopyValue}
        />
      );
    }

    const openBracket = node.type === "array" ? "[" : "{";
    const closeBracket = node.type === "array" ? "]" : "}";

    if (node.isRedacted && !isRevealed) {
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-accent-red/15 text-accent-red border border-accent-red/30">
            [REDACTED]
          </span>
          {canReveal && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => onReveal(node.path)}
            >
              <Eye className="h-3 w-3 mr-0.5" />
              Reveal
            </Button>
          )}
        </span>
      );
    }

    if (!node.isExpanded) {
      const label = node.type === "array" ? `Array(${node.childCount})` : `{${node.childCount} keys}`;
      return (
        <span className="text-foreground-muted">
          {openBracket}
          <span className="italic text-[11px]">{label}</span>
          {closeBracket}
        </span>
      );
    }

    if (node.childCount === 0) {
      return <span className="text-foreground-muted">{openBracket}{closeBracket}</span>;
    }

    return <span className="text-foreground-muted">{openBracket}</span>;
  };

  const renderClosingBracket = () => {
    if (node.type === "primitive" || !node.isExpanded || node.childCount === 0) {
      return null;
    }
    // Closing brackets are handled by the parent - we just show the opening here
    return null;
  };

  const renderComma = () => {
    if (node.isLastChild) return null;
    return <span className="text-foreground-muted">,</span>;
  };

  return (
    <div
      className={cn(
        "flex items-center h-6 group/row font-mono text-[13px] leading-6 relative",
        node.searchMatch && "bg-accent-yellow/10",
        node.isRedacted && !isRevealed && "bg-accent-red/5"
      )}
      style={{ paddingLeft: node.depth * INDENT_SIZE + (showLineNumbers ? 40 : 12) }}
    >
      {showLineNumbers && (
        <span className="absolute left-0 w-9 text-right pr-2 text-foreground-muted text-[11px] select-none">
          {lineNumber}
        </span>
      )}
      {renderToggle()}
      <span className="ml-1">
        {renderKey()}
        {renderBrackets()}
        {renderComma()}
        {renderClosingBracket()}
      </span>

      {/* Context menu */}
      <DropdownMenu open={showContextMenu} onOpenChange={setShowContextMenu}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 ml-2 opacity-0 group-hover/row:opacity-100 transition-opacity"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem onClick={handleCopyPath}>
            <ClipboardCopy className="h-3.5 w-3.5 mr-2" />
            Copy path
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCopyValue}>
            <Copy className="h-3.5 w-3.5 mr-2" />
            Copy value
          </DropdownMenuItem>
          {node.isRedacted && !isRevealed && canReveal && (
            <DropdownMenuItem onClick={() => onReveal(node.path)}>
              <Eye className="h-3.5 w-3.5 mr-2" />
              Reveal value
            </DropdownMenuItem>
          )}
          {node.isRedacted && isRevealed && (
            <DropdownMenuItem onClick={() => onReveal(node.path)}>
              <EyeOff className="h-3.5 w-3.5 mr-2" />
              Hide value
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});

// ============================================================================
// Closing Bracket Row
// ============================================================================

interface ClosingBracketRowProps {
  node: FlattenedNode;
  showLineNumbers: boolean;
  lineNumber: number;
}

const ClosingBracketRow = memo(function ClosingBracketRow({
  node,
  showLineNumbers,
  lineNumber,
}: ClosingBracketRowProps) {
  const closeBracket = node.type === "array" ? "]" : "}";

  return (
    <div
      className="flex items-center h-6 font-mono text-[13px] leading-6 relative"
      style={{ paddingLeft: node.depth * INDENT_SIZE + (showLineNumbers ? 40 : 12) + 16 }}
    >
      {showLineNumbers && (
        <span className="absolute left-0 w-9 text-right pr-2 text-foreground-muted text-[11px] select-none">
          {lineNumber}
        </span>
      )}
      <span className="text-foreground-muted">
        {closeBracket}
        {!node.isLastChild && ","}
      </span>
    </div>
  );
});

// ============================================================================
// Main JsonViewer Component
// ============================================================================

export function JsonViewer({
  data,
  collapsed = false,
  searchable = false,
  redactedPaths = [],
  canReveal = false,
  maxHeight = 400,
  showLineNumbers = false,
  onCopyPath,
  onCopyValue,
  className,
}: JsonViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [collapsedState, setCollapsedState] = useState<CollapsedState>(new Map());
  const [revealedState, setRevealedState] = useState<RevealedState>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [truncatedPaths, setTruncatedPaths] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  // Flatten the JSON for virtualization
  const flattenedNodes = useMemo(() => {
    return flattenJson(
      data,
      collapsedState,
      redactedPaths,
      searchQuery,
      collapsed
    );
  }, [data, collapsedState, redactedPaths, searchQuery, collapsed]);

  // Build rows with closing brackets
  const rows = useMemo(() => {
    const result: { type: "node" | "close"; node: FlattenedNode }[] = [];
    const openNodes: FlattenedNode[] = [];

    for (const node of flattenedNodes) {
      // Close any nodes that are at the same or lower depth
      while (openNodes.length > 0 && openNodes[openNodes.length - 1].depth >= node.depth) {
        const closingNode = openNodes.pop()!;
        if (closingNode.type !== "primitive" && closingNode.isExpanded && closingNode.childCount > 0) {
          result.push({ type: "close", node: closingNode });
        }
      }

      result.push({ type: "node", node });

      if (node.type !== "primitive" && node.isExpanded && node.childCount > 0 && !node.isRedacted) {
        openNodes.push(node);
      }
    }

    // Close remaining open nodes
    while (openNodes.length > 0) {
      const closingNode = openNodes.pop()!;
      if (closingNode.type !== "primitive" && closingNode.isExpanded && closingNode.childCount > 0) {
        result.push({ type: "close", node: closingNode });
      }
    }

    return result;
  }, [flattenedNodes]);

  // Virtualizer for large datasets
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: 20,
  });

  // Handlers
  const handleToggle = useCallback((path: string) => {
    setCollapsedState((prev) => {
      const next = new Map(prev);
      const isCurrentlyCollapsed = prev.get(path) ?? false;
      next.set(path, !isCurrentlyCollapsed);
      return next;
    });
  }, []);

  const handleReveal = useCallback((path: string) => {
    setRevealedState((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleShowMore = useCallback((path: string) => {
    setTruncatedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    setCollapsedState(new Map());
  }, []);

  const handleCollapseAll = useCallback(() => {
    const newState = new Map<string, boolean>();
    flattenedNodes.forEach((node) => {
      if (node.type !== "primitive" && node.depth > 0) {
        newState.set(node.path, true);
      }
    });
    setCollapsedState(newState);
  }, [flattenedNodes]);

  const handleCopyAll = useCallback(() => {
    const stringified = JSON.stringify(data, null, 2);
    navigator.clipboard.writeText(stringified);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [data]);

  const handleClearSearch = useCallback(() => {
    setSearchQuery("");
  }, []);

  // Check if revealed for a specific path (including parent paths)
  const isPathRevealed = useCallback(
    (path: string) => {
      if (revealedState.has(path)) return true;
      // Check if any parent path is revealed
      const parts = path.split(".");
      for (let i = 1; i < parts.length; i++) {
        const parentPath = parts.slice(0, i).join(".");
        if (revealedState.has(parentPath)) return true;
      }
      return false;
    },
    [revealedState]
  );

  // Search match count
  const matchCount = useMemo(() => {
    if (!searchQuery) return 0;
    return flattenedNodes.filter((n) => n.searchMatch).length;
  }, [flattenedNodes, searchQuery]);

  return (
    <TooltipProvider>
      <div className={cn("relative group rounded-lg border border-border bg-background-secondary", className)}>
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-background-tertiary/50">
          {searchable && (
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground-muted" />
              <Input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-7 pl-8 pr-8 text-xs bg-background border-border"
              />
              {searchQuery && (
                <button
                  onClick={handleClearSearch}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          {searchQuery && matchCount > 0 && (
            <span className="text-[11px] text-foreground-muted">
              {matchCount} match{matchCount !== 1 ? "es" : ""}
            </span>
          )}
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={handleExpandAll}
                >
                  <ChevronsUpDown className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Expand all</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={handleCollapseAll}
                >
                  <ChevronsDownUp className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Collapse all</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={handleCopyAll}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-accent-green" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy all</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* JSON Content */}
        <div
          ref={containerRef}
          className="overflow-auto"
          style={{ maxHeight, minHeight: 100 }}
        >
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (row.type === "close") {
                return (
                  <div
                    key={virtualRow.key}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: LINE_HEIGHT,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <ClosingBracketRow
                      node={row.node}
                      showLineNumbers={showLineNumbers}
                      lineNumber={virtualRow.index + 1}
                    />
                  </div>
                );
              }
              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: LINE_HEIGHT,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <NodeRow
                    node={row.node}
                    showLineNumbers={showLineNumbers}
                    lineNumber={virtualRow.index + 1}
                    searchQuery={searchQuery}
                    isRevealed={isPathRevealed(row.node.path)}
                    canReveal={canReveal}
                    truncatedPaths={truncatedPaths}
                    onToggle={handleToggle}
                    onReveal={handleReveal}
                    onShowMore={handleShowMore}
                    onCopyPath={onCopyPath}
                    onCopyValue={onCopyValue}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer with stats */}
        <div className="px-3 py-1.5 border-t border-border bg-background-tertiary/30 text-[11px] text-foreground-muted">
          {rows.length} lines
          {redactedPaths.length > 0 && (
            <span className="ml-2">
              | {flattenedNodes.filter((n) => n.isRedacted).length} redacted
            </span>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

// ============================================================================
// Exports
// ============================================================================

export type { JsonViewerProps };
