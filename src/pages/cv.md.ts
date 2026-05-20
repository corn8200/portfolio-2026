import type { APIRoute } from 'astro';
import { getCvRaw } from '@lib/content';

export const prerender = true;

export const GET: APIRoute = () => {
  const md = getCvRaw().replace(/<!--[\s\S]*?-->/g, '').trim();
  return new Response(md + '\n', {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': 'attachment; filename="john-cornelius-cv.md"',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
