// Everything is same-origin /api, so the session cookie and the Agent Pass callback
// live on one origin, as the World gates require.
const api = process.env.BACKEND_URL ?? "http://localhost:8787"
// The World backend. Until it runs, these paths reach the stand-in in the main API.
const world = process.env.WORLD_BACKEND_URL ?? api

const worldPaths = [
  "/api/world/:path*",
  "/api/session",
  "/api/session/:path*",
  "/api/agent/:path*",
  "/api/agent-pass/:path*",
  "/api/drafts",
  "/api/drafts/:path*",
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Minting ENS names takes real block confirmations, and the proxy's default 30s cuts them off.
  experimental: {
    proxyTimeout: 600_000,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      ...worldPaths.map((source) => ({ source, destination: `${world}${source}` })),
      { source: "/api/:path*", destination: `${api}/api/:path*` },
    ]
  },
}

export default nextConfig
