"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { ConnectionStatus } from "./connection-status";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

interface HeaderProps {
  title?: string;
}

export function Header({ title }: HeaderProps) {
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries();
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      {title && <h1 className="text-lg font-semibold">{title}</h1>}
      <div className="ml-auto flex items-center gap-4">
        <ConnectionStatus />
        <Button variant="ghost" size="icon" onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
