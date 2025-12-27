"use client";

import { Wrench } from "lucide-react";
import { ToolList } from "@/components/tools/tool-list";
import { CreateToolDialog } from "@/components/tools/create-tool-dialog";

export default function ToolsPage() {
  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Page header with gradient accent */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-accent-cyan/5 via-transparent to-transparent rounded-xl -z-10" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 pb-2">
            <div className="p-2.5 rounded-xl bg-accent-cyan/10 border border-accent-cyan/20">
              <Wrench className="h-5 w-5 text-accent-cyan" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Tool Registry</h1>
              <p className="text-sm text-muted-foreground">
                Manage available tools and their risk classifications
              </p>
            </div>
          </div>
          <CreateToolDialog />
        </div>
      </div>

      <ToolList />
    </div>
  );
}
