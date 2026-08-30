import type { NextConfig } from "next";

function getBasePath() {
  const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim();

  if (!configuredBasePath || configuredBasePath === "/") {
    return "";
  }

  return configuredBasePath.startsWith("/")
    ? configuredBasePath.replace(/\/$/, "")
    : `/${configuredBasePath.replace(/\/$/, "")}`;
}

const nextConfig: NextConfig = {
  basePath: getBasePath(),
};

export default nextConfig;
