import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SkipLink } from "@/components/layout/skip-link";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      {/* Skip navigation link for keyboard accessibility */}
      <SkipLink />
      <AppSidebar />
      <SidebarInset className="relative">
        {/* Subtle gradient mesh background for main content */}
        <div className="absolute inset-0 bg-gradient-mesh pointer-events-none opacity-50" />
        <main id="main-content" tabIndex={-1} className="outline-none relative z-10 min-h-screen">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
