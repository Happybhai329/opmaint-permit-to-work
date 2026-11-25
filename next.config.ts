import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {};

// Gives `next dev` the same D1 binding (env.DB) that the deployed Worker gets.
initOpenNextCloudflareForDev({ configPath: "./freebuff.wrangler.jsonc" });

export default nextConfig;
