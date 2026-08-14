/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["officeparser"],
    // lucide-react (per-icon files) and framer-motion were being pulled in
    // as their full barrel export on every import — this makes Next.js
    // rewrite each import to its actual submodule so unused icons/motion
    // internals never reach the client bundle at all, instead of relying on
    // webpack tree-shaking to catch it after the fact.
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
};

export default nextConfig;
