import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Note: Don't use 'env' block for server-side env vars - they're read at runtime
  // Only use 'env' for NEXT_PUBLIC_* vars that need to be inlined at build time
};

export default nextConfig;
