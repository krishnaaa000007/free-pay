/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  },
  /**
   * The demo pages are plain static files in /public. Vercel permanently redirects a
   * `.html` request to its extensionless form, so `/phone.html` lands on `/phone` - which
   * nothing serves, and the visitor gets a 404. These rewrites make the clean URL resolve
   * to the file, so both spellings work and a mistyped demo link cannot dead-end.
   */
  async rewrites() {
    return [
      { source: '/phone', destination: '/phone.html' },
      { source: '/stage', destination: '/stage.html' },
    ];
  },
};
export default nextConfig;
