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
  // The Excel export fills a template workbook read from disk at request time,
  // so it has to be shipped with the deployed route.
  outputFileTracingIncludes: {
    "/api/po-tracking/export": ["./src/lib/server/templates/**/*"],
  },
};

export default nextConfig;
