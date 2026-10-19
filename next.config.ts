import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Two <50 MB binary PNG parts plus multipart metadata.
  experimental: { middlewareClientMaxBodySize: 110_000_000 },
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
