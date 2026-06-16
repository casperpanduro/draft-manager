import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root — there is a sibling lockfile one level up.
  turbopack: {
    root: path.join(__dirname),
  },
  // Allow dev HMR/resource requests from these hosts (you can open the app at
  // localhost, 127.0.0.1, or the LAN IP).
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.86.39"],
};

export default nextConfig;
