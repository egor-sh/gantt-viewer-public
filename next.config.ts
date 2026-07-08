import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export → produces `out/` directory with pure HTML/JS/CSS.
  // Electron loads this directory directly — no Node.js server needed at runtime.
  output: "export",
  // Disable server-side image optimization (we use plain <img> anyway).
  images: {
    unoptimized: true,
  },
  // Use trailingSlash so opening index.html via file:// works correctly.
  trailingSlash: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
