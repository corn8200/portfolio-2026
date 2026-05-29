import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: { enabled: true, remoteBindings: false },
    imageService: 'passthrough',
  }),
  site: 'https://cv.jcornelius.net',
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
    server: { host: '127.0.0.1' },
  },
  server: { host: '127.0.0.1', port: 4321 },
  build: {
    inlineStylesheets: 'auto',
  },
});
