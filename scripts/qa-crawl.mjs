#!/usr/bin/env node
/**
 * QA crawl: visit each route at multiple breakpoints, capture console
 * messages + status, take screenshots, write a markdown report.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://cv.jcornelius.net';

const ROUTES = [
  { path: '/', expect: 200, kind: 'page' },
  { path: '/talk', expect: 200, kind: 'page' },
  { path: '/cv', expect: 200, kind: 'page' },
  { path: '/work', expect: 200, kind: 'page' },
  { path: '/work/tamko-ai-six-sigma-lead', expect: 200, kind: 'page' },
  { path: '/work/tamko-operations', expect: 200, kind: 'page' },
  { path: '/work/army-service', expect: 200, kind: 'page' },
  { path: '/work/education', expect: 200, kind: 'page' },
  { path: '/work/this-site', expect: 200, kind: 'page' },
  { path: '/contact', expect: 200, kind: 'page' },
  { path: '/xxxx-not-a-route', expect: 404, kind: 'page' },
  { path: '/cv.md', expect: 200, kind: 'asset', contentType: /text\/markdown|text\/plain/ },
  { path: '/sitemap.xml', expect: 200, kind: 'asset', contentType: /xml/ },
  { path: '/robots.txt', expect: 200, kind: 'asset', contentType: /text\/plain/ },
  { path: '/og/default.svg', expect: 200, kind: 'asset', contentType: /svg/ },
  { path: '/api/health', expect: 200, kind: 'json' },
];

const BREAKPOINTS = [
  { name: 'mobile-390', width: 390, height: 844, isMobile: true },
  { name: 'tablet-768', width: 768, height: 1024, isMobile: false },
  { name: 'desktop-1440', width: 1440, height: 900, isMobile: false },
];

const OUT_DIR = '/home/ubuntu/Projects/portfolio-2026/.tmp/qa-screenshots';
const REPORT_PATH = '/home/ubuntu/Projects/portfolio-2026/.tmp/qa-crawl-report.md';

function safeName(routePath) {
  if (routePath === '/') return 'root';
  return routePath.replace(/^\//, '').replace(/[\/?&=]/g, '_');
}

async function checkRoute(bp, route, browser) {
  const context = await browser.newContext({
    viewport: { width: bp.width, height: bp.height },
    deviceScaleFactor: 2,
    userAgent: bp.isMobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
    isMobile: bp.isMobile,
    hasTouch: bp.isMobile,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on('console', (msg) => {
    const t = msg.type();
    const text = msg.text();
    if (t === 'error') consoleErrors.push(text);
    else if (t === 'warning') consoleWarnings.push(text);
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('requestfailed', (req) => {
    failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });

  const url = BASE + route.path;
  const result = {
    route: route.path,
    breakpoint: bp.name,
    url,
    status: null,
    contentType: null,
    consoleErrors,
    consoleWarnings,
    pageErrors,
    failedRequests,
    screenshot: null,
    notes: [],
    timing_ms: null,
  };

  const t0 = Date.now();
  try {
    let response;
    if (route.kind === 'page' || route.kind === 'asset' || route.kind === 'json') {
      response = await page.goto(url, {
        waitUntil: route.kind === 'page' ? 'networkidle' : 'domcontentloaded',
        timeout: 30000,
      });
    }
    result.status = response ? response.status() : null;
    result.contentType = response?.headers()['content-type'] || null;

    if (route.kind === 'page') {
      // Settle any animations a bit.
      await page.waitForTimeout(800);
      const screenshotPath = path.join(OUT_DIR, bp.name, safeName(route.path) + '.png');
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });
      result.screenshot = screenshotPath;

      // Cheap structural sanity: detect horizontal overflow + invisible text.
      const layout = await page.evaluate(() => {
        const doc = document.documentElement;
        const overflowX = doc.scrollWidth > doc.clientWidth + 1
          ? { scrollW: doc.scrollWidth, clientW: doc.clientWidth }
          : null;
        const title = document.title || null;
        const h1Count = document.querySelectorAll('h1').length;
        const skipLinkPresent = !!document.querySelector('a[href="#main"], a.skip-link');
        const mainPresent = !!document.querySelector('main');
        const imgs = Array.from(document.querySelectorAll('img'));
        const imgIssues = imgs
          .filter((i) => !i.complete || i.naturalWidth === 0)
          .map((i) => i.currentSrc || i.src);
        // Look for clearly broken text — empty headings.
        const emptyHeadings = Array.from(document.querySelectorAll('h1,h2,h3'))
          .filter((h) => !h.textContent.trim()).length;
        return { overflowX, title, h1Count, skipLinkPresent, mainPresent, imgIssues, emptyHeadings };
      });
      result.layout = layout;
    } else if (route.kind === 'asset') {
      const body = await response.text();
      result.bodyPreview = body.slice(0, 200);
      result.bodyLength = body.length;
    } else if (route.kind === 'json') {
      const body = await response.text();
      try {
        result.json = JSON.parse(body);
      } catch (e) {
        result.notes.push('non-JSON body: ' + body.slice(0, 200));
      }
    }
  } catch (err) {
    result.notes.push('navigation error: ' + (err.message || String(err)));
  }
  result.timing_ms = Date.now() - t0;

  await context.close();
  return result;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const allResults = [];

  for (const bp of BREAKPOINTS) {
    console.log(`\n=== Breakpoint: ${bp.name} (${bp.width}x${bp.height}) ===`);
    for (const route of ROUTES) {
      // Assets and the API/health only need one breakpoint pass.
      if ((route.kind === 'asset' || route.kind === 'json') && bp.name !== 'desktop-1440') continue;
      process.stdout.write(`  ${route.path} ... `);
      const r = await checkRoute(bp, route, browser);
      const statusMark = r.status === route.expect ? 'ok' : `STATUS_MISMATCH(${r.status} vs ${route.expect})`;
      const errMark = r.consoleErrors.length ? `errs=${r.consoleErrors.length}` : '';
      const pageErrMark = r.pageErrors.length ? `pageErr=${r.pageErrors.length}` : '';
      console.log([statusMark, errMark, pageErrMark, `${r.timing_ms}ms`].filter(Boolean).join(' '));
      allResults.push({ ...r, expect: route.expect, kind: route.kind, contentTypeExpect: route.contentType?.toString() });
    }
  }

  await browser.close();

  // Build punch list.
  const issues = [];
  for (const r of allResults) {
    if (r.status !== r.expect) {
      issues.push({
        severity: 'CRITICAL',
        route: r.route,
        breakpoint: r.breakpoint,
        kind: 'wrong-status',
        detail: `Expected ${r.expect}, got ${r.status}.`,
      });
    }
    if (r.kind === 'asset' && r.contentTypeExpect && r.contentType && !new RegExp(r.contentTypeExpect.replace(/^\/|\/$/g, '')).test(r.contentType)) {
      issues.push({
        severity: 'HIGH',
        route: r.route,
        breakpoint: r.breakpoint,
        kind: 'wrong-content-type',
        detail: `Expected ${r.contentTypeExpect}, got ${r.contentType}.`,
      });
    }
    for (const e of r.pageErrors) {
      issues.push({
        severity: 'CRITICAL',
        route: r.route,
        breakpoint: r.breakpoint,
        kind: 'page-error',
        detail: e,
      });
    }
    for (const e of r.consoleErrors) {
      // Ignore favicon 404s and known noisy patterns; keep everything else.
      if (/favicon/i.test(e)) continue;
      issues.push({
        severity: 'HIGH',
        route: r.route,
        breakpoint: r.breakpoint,
        kind: 'console-error',
        detail: e,
      });
    }
    for (const e of r.consoleWarnings) {
      issues.push({
        severity: 'MEDIUM',
        route: r.route,
        breakpoint: r.breakpoint,
        kind: 'console-warning',
        detail: e,
      });
    }
    for (const f of r.failedRequests) {
      issues.push({
        severity: 'HIGH',
        route: r.route,
        breakpoint: r.breakpoint,
        kind: 'failed-request',
        detail: f,
      });
    }
    if (r.layout?.overflowX) {
      issues.push({
        severity: 'HIGH',
        route: r.route,
        breakpoint: r.breakpoint,
        kind: 'horizontal-overflow',
        detail: `scrollWidth ${r.layout.overflowX.scrollW} > clientWidth ${r.layout.overflowX.clientW}`,
      });
    }
    if (r.layout && r.layout.h1Count === 0 && r.kind === 'page') {
      issues.push({
        severity: 'MEDIUM',
        route: r.route,
        breakpoint: r.breakpoint,
        kind: 'no-h1',
        detail: 'Page has no <h1>.',
      });
    }
    if (r.layout && r.layout.h1Count > 1 && r.kind === 'page') {
      issues.push({
        severity: 'LOW',
        route: r.route,
        breakpoint: r.breakpoint,
        kind: 'multiple-h1',
        detail: `Page has ${r.layout.h1Count} <h1> elements.`,
      });
    }
    if (r.layout && !r.layout.mainPresent && r.kind === 'page') {
      issues.push({
        severity: 'MEDIUM',
        route: r.route,
        breakpoint: r.breakpoint,
        kind: 'no-main',
        detail: 'No <main> landmark.',
      });
    }
    if (r.layout && !r.layout.skipLinkPresent && r.kind === 'page') {
      issues.push({
        severity: 'LOW',
        route: r.route,
        breakpoint: r.breakpoint,
        kind: 'no-skip-link',
        detail: 'No skip-to-content link.',
      });
    }
    if (r.layout?.imgIssues?.length) {
      issues.push({
        severity: 'HIGH',
        route: r.route,
        breakpoint: r.breakpoint,
        kind: 'broken-image',
        detail: r.layout.imgIssues.join(', '),
      });
    }
    if (r.layout?.emptyHeadings) {
      issues.push({
        severity: 'MEDIUM',
        route: r.route,
        breakpoint: r.breakpoint,
        kind: 'empty-heading',
        detail: `${r.layout.emptyHeadings} empty heading(s).`,
      });
    }
    if (r.kind === 'json' && r.json) {
      const j = r.json;
      if (j.ok !== true) {
        issues.push({
          severity: 'CRITICAL',
          route: r.route,
          breakpoint: r.breakpoint,
          kind: 'health-not-ok',
          detail: JSON.stringify(j),
        });
      } else if (j.services) {
        for (const [name, svc] of Object.entries(j.services)) {
          if (!svc.ok) {
            issues.push({
              severity: 'HIGH',
              route: r.route,
              breakpoint: r.breakpoint,
              kind: 'health-degraded',
              detail: `${name}: ${JSON.stringify(svc)}`,
            });
          }
        }
      }
    }
  }

  const sev = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  issues.sort((a, b) => sev[a.severity] - sev[b.severity]);

  // Markdown report.
  const lines = [];
  lines.push('# QA Crawl Report');
  lines.push('');
  lines.push(`- Site: ${BASE}`);
  lines.push(`- Date: ${new Date().toISOString()}`);
  lines.push(`- Routes checked: ${ROUTES.length}`);
  lines.push(`- Breakpoints: ${BREAKPOINTS.map((b) => `${b.name} (${b.width}x${b.height})`).join(', ')}`);
  const ok = allResults.filter((r) => r.status === r.expect).length;
  lines.push(`- Pass rate (status match): ${ok}/${allResults.length}`);
  lines.push(`- Total issues: ${issues.length}`);
  lines.push('');
  lines.push('## Per-route results');
  lines.push('');
  for (const r of allResults) {
    lines.push(`### ${r.route} @ ${r.breakpoint}`);
    lines.push(`- URL: ${r.url}`);
    lines.push(`- Status: ${r.status} (expected ${r.expect})`);
    if (r.contentType) lines.push(`- Content-Type: ${r.contentType}`);
    lines.push(`- Time: ${r.timing_ms}ms`);
    if (r.screenshot) lines.push(`- Screenshot: ${r.screenshot}`);
    if (r.layout) {
      lines.push(`- Title: ${JSON.stringify(r.layout.title)}`);
      lines.push(`- H1 count: ${r.layout.h1Count}, main: ${r.layout.mainPresent}, skip-link: ${r.layout.skipLinkPresent}`);
      if (r.layout.overflowX) lines.push(`- Horizontal overflow: scrollWidth=${r.layout.overflowX.scrollW} clientWidth=${r.layout.overflowX.clientW}`);
      if (r.layout.imgIssues?.length) lines.push(`- Broken images: ${r.layout.imgIssues.join(', ')}`);
    }
    if (r.consoleErrors.length) lines.push(`- Console errors:\n${r.consoleErrors.map((e) => '  - ' + e).join('\n')}`);
    if (r.consoleWarnings.length) lines.push(`- Console warnings:\n${r.consoleWarnings.map((e) => '  - ' + e).join('\n')}`);
    if (r.pageErrors.length) lines.push(`- Page errors:\n${r.pageErrors.map((e) => '  - ' + e).join('\n')}`);
    if (r.failedRequests.length) lines.push(`- Failed requests:\n${r.failedRequests.map((e) => '  - ' + e).join('\n')}`);
    if (r.bodyPreview) lines.push(`- Body preview: \`${r.bodyPreview.replace(/`/g, "'").slice(0, 200)}\``);
    if (r.json) lines.push(`- JSON: \`${JSON.stringify(r.json).slice(0, 400)}\``);
    if (r.notes.length) lines.push(`- Notes:\n${r.notes.map((n) => '  - ' + n).join('\n')}`);
    lines.push('');
  }

  lines.push('## Punch list (ranked)');
  lines.push('');
  for (const sevLevel of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
    const bucket = issues.filter((i) => i.severity === sevLevel);
    if (!bucket.length) continue;
    lines.push(`### ${sevLevel} (${bucket.length})`);
    for (const i of bucket) {
      lines.push(`- [${i.kind}] ${i.route} @ ${i.breakpoint}: ${i.detail}`);
    }
    lines.push('');
  }

  await writeFile(REPORT_PATH, lines.join('\n'));
  await writeFile(REPORT_PATH.replace(/\.md$/, '.json'), JSON.stringify({ results: allResults, issues }, null, 2));
  console.log(`\nReport: ${REPORT_PATH}`);
  console.log(`Issues: ${issues.length} (${issues.filter((i) => i.severity === 'CRITICAL').length} critical, ${issues.filter((i) => i.severity === 'HIGH').length} high)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
