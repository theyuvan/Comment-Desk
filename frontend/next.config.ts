import type { NextConfig } from "next";

const backend = process.env.BACKEND_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["@commentdesk/shared"],
  // Same-origin /api so the session cookie and the Agent Pass callback live on one origin.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};

export default nextConfig;
