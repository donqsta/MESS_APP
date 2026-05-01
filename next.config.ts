import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Không watch thư mục data/ để tránh hot-reload khi ghi cookie/seen file
  watchOptions: {
    ignored: [path.resolve("data")],
  },
};

export default nextConfig;
