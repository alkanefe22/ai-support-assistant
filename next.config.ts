import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "5mb" },
  },
  // unpdf ships a large pdf.js build; keep it out of the server bundle.
  serverExternalPackages: ["unpdf"],
  // The demo knowledge base is read from disk on first start (auto-seed); ship it with every function.
  outputFileTracingIncludes: { "/**": ["./data/seed/**"] },
};

export default nextConfig;
