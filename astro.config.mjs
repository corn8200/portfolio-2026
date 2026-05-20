import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: { enabled: true },
    imageService: 'passthrough',
  }),
  site: 'https://portfolio-2026.pages.dev',
  prefetch: { prefetchAll: true, defaultStrategy: 'viewport' },
  experimental: {
    clientPrerender: true,
  },
  vite: {
    ssr: { external: ['node:buffer', 'node:crypto'] },
    build: {
      cssMinify: 'esbuild',
      assetsInlineLimit: 4096,
    },
    server: { host: '0.0.0.0' },
  },
  server: { host: '0.0.0.0', port: 4321 },
  build: {
    inlineStylesheets: 'auto',
  },
});
