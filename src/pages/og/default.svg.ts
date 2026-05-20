import type { APIRoute } from 'astro';

export const prerender = true;

// SVG OG image. Renders the brand at 1200x630.
// SVG-as-OG works in most modern scrapers; Twitter prefers raster but accepts SVG.
// For full coverage we can render to PNG at build time later — this is the fast ship.

export const GET: APIRoute = () => {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <radialGradient id="g" cx="62%" cy="35%" r="60%">
      <stop offset="0" stop-color="#1A1612"/>
      <stop offset="1" stop-color="#18140F"/>
    </radialGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0H0V40" fill="none" stroke="#3A332C" stroke-width="0.5"/>
    </pattern>
  </defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  <rect width="1200" height="630" fill="url(#grid)" opacity="0.5"/>
  <g transform="translate(80, 90)">
    <text x="0" y="0" font-family="ui-monospace, monospace" font-size="20" letter-spacing="3" fill="#8A8175">HARPERS FERRY, WV</text>
    <text x="0" y="180" font-family="ui-sans-serif, -apple-system, system-ui" font-weight="460" font-size="120" fill="#ECE7DD" letter-spacing="-3">
      John Cornelius
    </text>
    <text x="0" y="320" font-family="ui-sans-serif, -apple-system, system-ui" font-weight="450" font-size="34" fill="#C7BEAD">
      AI &amp; Six Sigma Lead, Tamko &middot; Veteran, 160th SOAR
    </text>
    <text x="0" y="450" font-family="ui-monospace, monospace" font-size="20" letter-spacing="2" fill="#B4AB9C">
      cv.jcornelius.net  &#x2022;  corn82@icloud.com
    </text>
  </g>
  <circle cx="1080" cy="120" r="6" fill="#E89A3F"/>
  <circle cx="1080" cy="120" r="14" fill="none" stroke="#E89A3F" stroke-width="1" opacity="0.5"/>
  <circle cx="1080" cy="120" r="24" fill="none" stroke="#E89A3F" stroke-width="0.6" opacity="0.25"/>
</svg>`;
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
