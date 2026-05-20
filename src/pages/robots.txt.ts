import type { APIRoute } from 'astro';

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL('/sitemap.xml', site ?? 'https://portfolio-2026.pages.dev').toString();
  const body = `User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${sitemap}
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain' } });
};
