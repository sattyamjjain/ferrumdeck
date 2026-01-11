import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/components/providers/query-provider";
import { Toaster } from "@/components/ui/sonner";

// Primary sans-serif - IBM Plex Sans for clean, technical readability
const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

// Monospace - JetBrains Mono for code, IDs, and technical data
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "FerrumDeck | AgentOps Control Plane",
  description: "Mission Control for AI Agent Operations - Monitor, govern, and optimize your agentic workflows",
  keywords: ["AI", "agents", "operations", "control plane", "monitoring", "governance"],
  authors: [{ name: "FerrumDeck Team" }],
  icons: {
    icon: "/favicon.ico",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#06080c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${ibmPlexSans.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <QueryProvider>
          <div className="relative min-h-screen bg-background">
            {/* Subtle background grid pattern */}
            <div className="fixed inset-0 bg-grid pointer-events-none" />
            {/* Radial glow at top */}
            <div className="fixed inset-0 bg-radial-glow pointer-events-none" />
            {/* Content */}
            <div className="relative z-10">
              {children}
            </div>
          </div>
          <Toaster
            position="bottom-right"
            toastOptions={{
              className: "bg-background-elevated border-border text-foreground",
              style: {
                background: 'var(--background-elevated)',
                border: '1px solid var(--border)',
                color: 'var(--foreground)',
              },
            }}
          />
        </QueryProvider>
      </body>
    </html>
  );
}
