/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['pg-boss'],
  },
};

module.exports = nextConfig;
