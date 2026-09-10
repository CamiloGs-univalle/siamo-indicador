/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["jose", "jwks-rsa"],
  },
};

export default nextConfig;
