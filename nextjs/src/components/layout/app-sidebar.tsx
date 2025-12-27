"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Play,
  CheckCircle,
  Bot,
  Wrench,
  BarChart3,
  ScrollText,
  Settings,
  Key,
  Zap,
  GitBranch,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { fetchApprovals } from "@/lib/api/approvals";
import { cn } from "@/lib/utils";

const mainNavItems = [
  {
    title: "Runs",
    href: "/runs",
    icon: Play,
    description: "Monitor executions",
  },
  {
    title: "Approvals",
    href: "/approvals",
    icon: CheckCircle,
    badge: true,
    description: "Pending actions",
  },
];

const registryNavItems = [
  {
    title: "Agents",
    href: "/agents",
    icon: Bot,
    description: "AI configurations",
  },
  {
    title: "Tools",
    href: "/tools",
    icon: Wrench,
    description: "Available tools",
  },
  {
    title: "Workflows",
    href: "/workflows",
    icon: GitBranch,
    description: "Multi-step orchestration",
  },
];

const analyticsNavItems = [
  {
    title: "Analytics",
    href: "/analytics",
    icon: BarChart3,
    description: "Usage metrics",
  },
  {
    title: "Audit Logs",
    href: "/audit",
    icon: ScrollText,
    description: "Activity history",
  },
];

const settingsNavItems = [
  {
    title: "API Keys",
    href: "/settings/api-keys",
    icon: Key,
  },
  {
    title: "Settings",
    href: "/settings",
    icon: Settings,
  },
];

export function AppSidebar() {
  const pathname = usePathname();

  const { data: approvals } = useQuery({
    queryKey: ["approvals"],
    queryFn: () => fetchApprovals({ limit: 50 }),
    refetchInterval: 3000,
  });

  const pendingCount = approvals?.filter((a) => a.status === "pending").length || 0;

  return (
    <Sidebar className="border-r border-border/50">
      <SidebarHeader className="border-b border-border/50 px-4 py-4">
        <Link href="/runs" className="flex items-center gap-3 group">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-red-600 shadow-lg shadow-orange-500/20 transition-transform group-hover:scale-105">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-base font-semibold tracking-tight">FerrumDeck</span>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Control Plane</span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2 py-4">
        <SidebarGroup>
          <SidebarGroupLabel className="px-2 text-[10px] uppercase tracking-widest text-muted-foreground/70 font-medium">
            Operations
          </SidebarGroupLabel>
          <SidebarGroupContent className="mt-2">
            <SidebarMenu>
              {mainNavItems.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      className={cn(
                        "relative h-10 transition-all duration-200",
                        isActive && "bg-accent/80"
                      )}
                    >
                      <Link href={item.href}>
                        <item.icon className={cn(
                          "h-4 w-4 transition-colors",
                          isActive ? "text-primary" : "text-muted-foreground"
                        )} />
                        <span className="font-medium">{item.title}</span>
                        {item.badge && pendingCount > 0 && (
                          <Badge
                            className="ml-auto h-5 min-w-5 px-1.5 bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30"
                          >
                            {pendingCount}
                          </Badge>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-4">
          <SidebarGroupLabel className="px-2 text-[10px] uppercase tracking-widest text-muted-foreground/70 font-medium">
            Registry
          </SidebarGroupLabel>
          <SidebarGroupContent className="mt-2">
            <SidebarMenu>
              {registryNavItems.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      className={cn(
                        "relative h-10 transition-all duration-200",
                        isActive && "bg-accent/80"
                      )}
                    >
                      <Link href={item.href}>
                        <item.icon className={cn(
                          "h-4 w-4 transition-colors",
                          isActive ? "text-primary" : "text-muted-foreground"
                        )} />
                        <span className="font-medium">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-4">
          <SidebarGroupLabel className="px-2 text-[10px] uppercase tracking-widest text-muted-foreground/70 font-medium">
            Insights
          </SidebarGroupLabel>
          <SidebarGroupContent className="mt-2">
            <SidebarMenu>
              {analyticsNavItems.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      className={cn(
                        "relative h-10 transition-all duration-200",
                        isActive && "bg-accent/80"
                      )}
                    >
                      <Link href={item.href}>
                        <item.icon className={cn(
                          "h-4 w-4 transition-colors",
                          isActive ? "text-primary" : "text-muted-foreground"
                        )} />
                        <span className="font-medium">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-border/50 px-2 py-3">
        <SidebarMenu>
          {settingsNavItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive}
                  className={cn(
                    "h-9 transition-all duration-200",
                    isActive && "bg-accent/80"
                  )}
                >
                  <Link href={item.href}>
                    <item.icon className={cn(
                      "h-4 w-4 transition-colors",
                      isActive ? "text-primary" : "text-muted-foreground"
                    )} />
                    <span className="font-medium text-sm">{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
