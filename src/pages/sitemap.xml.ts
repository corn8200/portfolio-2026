import type { APIRoute } from 'astro';
import { getAllProjects } from '@lib/content';

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const base = (site ?? 'https://portfolio-2026.pages.dev').toString().replace(/\/$/, '');
  const projects = getAllProjects();
  const urls = [
    { loc: `${base}/`,        cf: 'weekly' },
    { loc: `${base}/cv`,      cf: 'weekly' },
    { loc: `${base}/work`,    cf: 'monthly' },
    { loc: `${base}/about`,   cf: 'monthly' },
    { loc: `${base}/contact`, cf: 'yearly' },
    ...projects.map((p) => ({ loc: `${base}${p.url}`, cf: 'monthly' })),
  ];
  const now = new Date().toISOString();
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${u.cf}</changefreq>
  </url>`).join('\n')}
</urlset>`;
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
