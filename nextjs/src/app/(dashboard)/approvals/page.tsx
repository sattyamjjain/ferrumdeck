"use client";

import { Shield } from "lucide-react";
import { ApprovalList } from "@/components/approvals/approval-list";

export default function ApprovalsPage() {
  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Page header with gradient accent */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-accent-purple/5 via-transparent to-transparent rounded-xl -z-10" />
        <div className="flex items-center gap-3 pb-2">
          <div className="p-2.5 rounded-xl bg-accent-purple/10 border border-accent-purple/20">
            <Shield className="h-5 w-5 text-accent-purple" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Approval Queue</h1>
            <p className="text-sm text-muted-foreground">
              Review and approve sensitive agent actions
            </p>
          </div>
        </div>
      </div>

      <ApprovalList />
    </div>
  );
}
