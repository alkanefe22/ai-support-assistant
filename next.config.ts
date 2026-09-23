import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "5mb" },
  },
  // unpdf ships a large pdf.js build; keep it out of the server bundle.
  serverExternalPackages: ["unpdf"],
};

export default nextConfig;
