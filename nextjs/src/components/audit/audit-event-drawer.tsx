"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  User,
  Bot,
  Key,
  Settings,
  ExternalLink,
  Copy,
  Check,
  EyeOff,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { JsonViewer } from "@/components/shared/json-viewer";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AuditEvent, AuditActorType } from "@/types/audit";
import { getEventTypeColors } from "@/types/audit";
import {
  getEventTypeDisplayName,
  getActorTypeDisplayName,
  getResourceTypeDisplayName,
  getFullTimestamp,
} from "@/hooks/use-audit";

// ============================================================================
// Types
// ============================================================================

interface AuditEventDrawerProps {
  event: AuditEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ============================================================================
// Helper Components
// ============================================================================

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy}>
          {copied ? (
            <Check className="h-3 w-3 text-green-400" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {copied ? "Copied!" : label || "Copy to clipboard"}
      </TooltipContent>
    </Tooltip>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
      {children}
    </h4>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
  link,
  copyable = false,
}: {
  label: string;
  value: string | undefined | null;
  mono?: boolean;
  link?: string;
  copyable?: boolean;
}) {
  if (!value) return null;

  return (
    <div className="flex items-start justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        {link ? (
          <Link
            href={link}
            className={cn(
              "text-sm text-right hover:text-primary transition-colors",
              mono && "font-mono"
            )}
          >
            {value}
            <ExternalLink className="inline-block h-3 w-3 ml-1" />
          </Link>
        ) : (
          <span className={cn("text-sm text-right", mono && "font-mono text-slate-300")}>
            {value}
          </span>
        )}
        {copyable && <CopyButton text={value} />}
      </div>
    </div>
  );
}

function ActorIconDisplay({ actorType, className }: { actorType: AuditActorType; className?: string }) {
  switch (actorType) {
    case "user":
      return <User className={className} />;
    case "api_key":
      return <Key className={className} />;
    case "agent":
      return <Bot className={className} />;
    case "system":
      return <Settings className={className} />;
    default:
      return <User className={className} />;
  }
}

// ============================================================================
// Related Entities Section
// ============================================================================

interface RelatedEntity {
  type: string;
  id: string;
  link: string;
}

function RelatedEntitiesSection({ event }: { event: AuditEvent }) {
  const entities = useMemo(() => {
    const result: RelatedEntity[] = [];

    // Run link
    if (event.run_id) {
      result.push({
        type: "Run",
        id: event.run_id,
        link: `/runs/${event.run_id}`,
      });
    }

    // Step link (if we have a run_id for context)
    if (event.step_id && event.run_id) {
      result.push({
        type: "Step",
        id: event.step_id,
        link: `/runs/${event.run_id}?step=${event.step_id}`,
      });
    }

    // Policy link
    if (event.policy_id) {
      result.push({
        type: "Policy",
        id: event.policy_id,
        link: `/settings/policies/${event.policy_id}`,
      });
    }

    // Target entity link
    const targetType = event.target_type || event.resource_type;
    const targetId = event.target_id || event.resource_id;
    if (targetType && targetId) {
      let link: string | null = null;
      switch (targetType) {
        case "agent":
          link = `/agents/${targetId}`;
          break;
        case "tool":
          link = `/tools/${targetId}`;
          break;
        case "approval":
          link = `/approvals`;
          break;
      }
      if (link && !result.some((e) => e.link === link)) {
        result.push({
          type: getResourceTypeDisplayName(targetType),
          id: targetId,
          link,
        });
      }
    }

    return result;
  }, [event]);

  if (entities.length === 0) return null;

  return (
    <div className="space-y-2">
      <SectionHeader>Related Entities</SectionHeader>
      <div className="space-y-2">
        {entities.map((entity) => (
          <Link
            key={`${entity.type}-${entity.id}`}
            href={entity.link}
            className="flex items-center justify-between p-2 rounded-md bg-slate-800/50 hover:bg-slate-800 transition-colors group"
          >
            <span className="text-sm text-muted-foreground">{entity.type}</span>
            <span className="text-sm font-mono text-slate-300 group-hover:text-primary transition-colors">
              {entity.id.length > 20 ? `${entity.id.slice(0, 20)}...` : entity.id}
              <ExternalLink className="inline-block h-3 w-3 ml-1.5" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Redaction Indicator
// ============================================================================

function RedactionIndicator({ fields }: { fields: string[] }) {
  const [showAll, setShowAll] = useState(false);
  const displayFields = showAll ? fields : fields.slice(0, 3);
  const hasMore = fields.length > 3;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <EyeOff className="h-4 w-4 text-yellow-500" />
        <span className="text-sm text-yellow-500 font-medium">Redacted Fields</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {displayFields.map((field) => (
          <Badge
            key={field}
            variant="outline"
            className="bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
          >
            {field}
          </Badge>
        ))}
        {hasMore && !showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            +{fields.length - 3} more
          </button>
        )}
        {showAll && hasMore && (
          <button
            onClick={() => setShowAll(false)}
            className="text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            Show less
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function AuditEventDrawer({ event, open, onOpenChange }: AuditEventDrawerProps) {
  if (!event) return null;

  const eventType = event.event_type || event.action;
  const colors = getEventTypeColors(eventType);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="space-y-3 pb-4">
          <div className="flex items-start justify-between">
            <Badge
              variant="outline"
              className={cn("gap-1.5 font-medium text-sm", colors.bg, colors.text, colors.border)}
            >
              {getEventTypeDisplayName(eventType)}
            </Badge>
          </div>
          <SheetTitle className="text-left">Audit Event Details</SheetTitle>
          <SheetDescription className="text-left">
            View complete information about this audit event.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 py-4">
          {/* Event Information */}
          <div className="space-y-2">
            <SectionHeader>Event Information</SectionHeader>
            <div className="rounded-lg bg-slate-900/50 border border-slate-800 p-4 space-y-2">
              <DetailRow label="Event ID" value={event.id} mono copyable />
              <DetailRow label="Event Type" value={eventType} />
              <Separator className="my-2 bg-slate-800" />
              <DetailRow
                label="Timestamp"
                value={getFullTimestamp(event.occurred_at)}
              />
              {event.request_id && (
                <DetailRow label="Request ID" value={event.request_id} mono copyable />
              )}
              {event.trace_id && (
                <DetailRow label="Trace ID" value={event.trace_id} mono copyable />
              )}
              {event.span_id && (
                <DetailRow label="Span ID" value={event.span_id} mono copyable />
              )}
            </div>
          </div>

          {/* Actor Information */}
          <div className="space-y-2">
            <SectionHeader>Actor</SectionHeader>
            <div className="rounded-lg bg-slate-900/50 border border-slate-800 p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-lg bg-slate-800">
                  <ActorIconDisplay actorType={event.actor_type} className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium">{event.actor_name || event.actor_id}</p>
                  <p className="text-sm text-muted-foreground">
                    {getActorTypeDisplayName(event.actor_type)}
                  </p>
                </div>
              </div>
              <div className="space-y-1">
                <DetailRow label="Actor ID" value={event.actor_id} mono copyable />
                {event.actor_email && (
                  <DetailRow label="Email" value={event.actor_email} />
                )}
              </div>
            </div>
          </div>

          {/* Target Information */}
          <div className="space-y-2">
            <SectionHeader>Target</SectionHeader>
            <div className="rounded-lg bg-slate-900/50 border border-slate-800 p-4">
              <div className="space-y-1">
                <DetailRow
                  label="Type"
                  value={getResourceTypeDisplayName(event.target_type || event.resource_type)}
                />
                <DetailRow
                  label="ID"
                  value={event.target_id || event.resource_id}
                  mono
                  copyable
                />
                {event.target_name && (
                  <DetailRow label="Name" value={event.target_name} />
                )}
              </div>
            </div>
          </div>

          {/* Request Metadata */}
          {(event.ip_address || event.user_agent) && (
            <div className="space-y-2">
              <SectionHeader>Request Metadata</SectionHeader>
              <div className="rounded-lg bg-slate-900/50 border border-slate-800 p-4 space-y-1">
                {event.ip_address && (
                  <DetailRow label="IP Address" value={event.ip_address} mono />
                )}
                {event.user_agent && (
                  <div className="py-1.5">
                    <span className="text-sm text-muted-foreground block mb-1">
                      User Agent
                    </span>
                    <p className="text-xs font-mono text-slate-400 break-all">
                      {event.user_agent}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Redacted Fields */}
          {event.redacted_fields && event.redacted_fields.length > 0 && (
            <div className="rounded-lg bg-yellow-500/5 border border-yellow-500/20 p-4">
              <RedactionIndicator fields={event.redacted_fields} />
            </div>
          )}

          {/* Related Entities */}
          <RelatedEntitiesSection event={event} />

          {/* Full Details JSON */}
          {Object.keys(event.details).length > 0 && (
            <div className="space-y-2">
              <SectionHeader>Event Details</SectionHeader>
              <div className="rounded-lg bg-slate-900/50 border border-slate-800 overflow-hidden">
                <JsonViewer data={event.details} collapsed />
              </div>
            </div>
          )}

          {/* Context IDs */}
          {(event.tenant_id || event.workspace_id || event.project_id) && (
            <div className="space-y-2">
              <SectionHeader>Context</SectionHeader>
              <div className="rounded-lg bg-slate-900/50 border border-slate-800 p-4 space-y-1">
                {event.tenant_id && (
                  <DetailRow label="Tenant ID" value={event.tenant_id} mono />
                )}
                {event.workspace_id && (
                  <DetailRow label="Workspace ID" value={event.workspace_id} mono />
                )}
                {event.project_id && (
                  <DetailRow label="Project ID" value={event.project_id} mono />
                )}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default AuditEventDrawer;
