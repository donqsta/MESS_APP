import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  webpack: (config, { dev }) => {
    // Không watch thư mục data/ để tránh hot-reload khi ghi cookie/seen file
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [/node_modules/, /\.next/, path.resolve("data")],
      };
    }
    return config;
  },
};

export default nextConfig;
