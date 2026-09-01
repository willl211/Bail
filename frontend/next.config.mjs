/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Web responsive uniquement — pas d'app native au MVP (docs/tech-stack.md).
  experimental: {},
};

export default nextConfig;
