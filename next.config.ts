import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Only use standalone output outside Vercel (e.g. Docker builds).
  // Vercel handles output tracing automatically and expects standard output structure.
  ...(process.env.VERCEL ? {} : { output: "standalone" }),
};

export default nextConfig;
