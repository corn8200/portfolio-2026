#!/usr/bin/env node
/**
 * Accessibility audit: runs axe-core against every route at desktop + mobile
 * breakpoints and writes a WCAG AA-focused report to .tmp/qa-a11y-report.md.
 *
 * Usage: node scripts/qa-a11y.mjs [--base=https://cv.jcornelius.net]
 */
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = (process.argv.find((a) => a.startsWith('--base=')) || '--base=https://cv.jcornelius.net').split('=')[1];

const ROUTES = [
  '/',
  '/talk',
  '/cv',
  '/work',
  '/work/tamko-ai-six-sigma-lead',
  '/work/tamko-operations',
  '/work/army-service',
  '/work/education',
  '/work/this-site',
  '/contact',
];

const VIEWPORTS = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'mobile', width: 390, height: 844 },
];

const SEVERITY_ORDER = ['critical', 'serious', 'moderate', 'minor'];

const REPORT_PATH = path.resolve('.tmp/qa-a11y-report.md');
const RAW_PATH = path.resolve('.tmp/qa-a11y-raw.json');

async function run() {
  const browser = await chromium.launch();
  const findings = []; // { route, viewport, violations: [...], canvasPresent: bool, error? }

  for (const route of ROUTES) {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();
      const url = BASE.replace(/\/$/, '') + route;
      const entry = { route, viewport: vp.label, url, violations: [], canvasPresent: false };
      try {
        const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
        entry.status = resp ? resp.status() : null;
        // Detect WebGL canvas presence (the brief says showCanvas=false should hide it)
        entry.canvasPresent = await page
          .locator('canvas')
          .count()
          .then((c) => c > 0)
          .catch(() => false);
        const axe = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
        const result = await axe.analyze();
        entry.violations = result.violations;
      } catch (err) {
        entry.error = String(err && err.message ? err.message : err);
      }
      findings.push(entry);
      await ctx.close();
      process.stdout.write(
        `  [${vp.label}] ${route} -> ${entry.error ? 'ERROR ' + entry.error : `${entry.violations.length} violations`} (canvas: ${entry.canvasPresent})\n`,
      );
    }
  }

  await browser.close();
  await fs.writeFile(RAW_PATH, JSON.stringify(findings, null, 2));
  await fs.writeFile(REPORT_PATH, renderReport(findings));
  console.log(`\nWrote ${REPORT_PATH}`);
  console.log(`Wrote ${RAW_PATH}`);
}

function renderReport(findings) {
  const totalRuns = findings.length;
  const totalViolations = findings.reduce((n, f) => n + (f.violations?.length || 0), 0);
  const bySeverity = { critical: [], serious: [], moderate: [], minor: [] };
  const canvasHits = findings.filter((f) => f.canvasPresent);

  for (const f of findings) {
    for (const v of f.violations || []) {
      const sev = v.impact || 'minor';
      (bySeverity[sev] || bySeverity.minor).push({ ...v, route: f.route, viewport: f.viewport });
    }
  }

  const generated = new Date().toISOString();
  const lines = [];
  lines.push(`# Accessibility Audit — ${BASE}`);
  lines.push('');
  lines.push(`Generated: ${generated}`);
  lines.push(`Routes scanned: ${ROUTES.length} × 2 viewports = ${totalRuns} runs.`);
  lines.push(`Tags: wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa.`);
  lines.push(`Total violations: **${totalViolations}**`);
  for (const sev of SEVERITY_ORDER) {
    lines.push(`- ${sev}: ${bySeverity[sev].length}`);
  }
  lines.push('');

  if (canvasHits.length) {
    lines.push(`## WebGL canvas detected (showCanvas=false should hide it)`);
    for (const c of canvasHits) {
      lines.push(`- [${c.viewport}] ${c.route}`);
    }
    lines.push('');
  } else {
    lines.push(`## WebGL canvas`);
    lines.push('No `<canvas>` elements detected on any route. OK.');
    lines.push('');
  }

  // Errors
  const errs = findings.filter((f) => f.error);
  if (errs.length) {
    lines.push(`## Navigation errors`);
    for (const e of errs) {
      lines.push(`- [${e.viewport}] ${e.route} — ${e.error}`);
    }
    lines.push('');
  }

  // Per-severity sections
  for (const sev of SEVERITY_ORDER) {
    const arr = bySeverity[sev];
    lines.push(`## ${sev.toUpperCase()} (${arr.length})`);
    if (!arr.length) {
      lines.push('None.');
      lines.push('');
      continue;
    }
    // group by rule id, then list per-route/viewport
    const byRule = new Map();
    for (const v of arr) {
      const key = v.id;
      if (!byRule.has(key)) byRule.set(key, []);
      byRule.get(key).push(v);
    }
    for (const [ruleId, group] of byRule) {
      const sample = group[0];
      const wcag = (sample.tags || []).filter((t) => /^wcag/.test(t)).join(', ');
      lines.push(`### \`${ruleId}\` — ${sample.help}`);
      lines.push(`- WCAG: ${wcag || 'n/a'}`);
      lines.push(`- Help URL: ${sample.helpUrl}`);
      lines.push(`- Severity: ${sev}`);
      lines.push(`- Fix: ${oneLineFix(ruleId, sample)}`);
      lines.push(`- Affected (${group.length} instances across routes):`);
      // collapse by route+viewport
      const collapsed = new Map();
      for (const g of group) {
        const k = `${g.route} (${g.viewport})`;
        if (!collapsed.has(k)) collapsed.set(k, []);
        collapsed.get(k).push(...(g.nodes || []));
      }
      for (const [where, nodes] of collapsed) {
        lines.push(`  - **${where}** — ${nodes.length} node(s)`);
        for (const n of nodes.slice(0, 5)) {
          const target = Array.isArray(n.target) ? n.target.join(' ') : String(n.target);
          const fail = (n.failureSummary || '').replace(/\n+/g, ' ').slice(0, 240);
          lines.push(`    - \`${target}\``);
          if (fail) lines.push(`      - ${fail}`);
        }
        if (nodes.length > 5) lines.push(`    - …and ${nodes.length - 5} more.`);
      }
      lines.push('');
    }
  }

  // Targeted check appendix
  lines.push(`## Targeted checks`);
  lines.push('');
  lines.push('| Concern | Result |');
  lines.push('|---|---|');
  lines.push(`| Color contrast (\`color-contrast\`) | ${countRule(bySeverity, 'color-contrast')} violations |`);
  lines.push(`| Form labels (\`label\`, \`form-field-multiple-labels\`, \`label-title-only\`) | ${countRule(bySeverity, 'label') + countRule(bySeverity, 'form-field-multiple-labels') + countRule(bySeverity, 'label-title-only')} violations |`);
  lines.push(`| ARIA live regions / valid attrs | ${countRule(bySeverity, 'aria-valid-attr') + countRule(bySeverity, 'aria-valid-attr-value') + countRule(bySeverity, 'aria-allowed-attr')} violations |`);
  lines.push(`| Keyboard / focusable (\`focus-order-semantics\`, \`tabindex\`) | ${countRule(bySeverity, 'focus-order-semantics') + countRule(bySeverity, 'tabindex')} violations |`);
  lines.push(`| Skip link / landmark (\`bypass\`, \`region\`, \`landmark-one-main\`) | ${countRule(bySeverity, 'bypass') + countRule(bySeverity, 'region') + countRule(bySeverity, 'landmark-one-main')} violations |`);
  lines.push('');
  lines.push('_Focus visibility is not directly testable by axe; verify the 2px outline manually with `:focus-visible` snapshots._');

  return lines.join('\n');
}

function countRule(bySeverity, id) {
  let n = 0;
  for (const sev of SEVERITY_ORDER) for (const v of bySeverity[sev]) if (v.id === id) n += 1;
  return n;
}

function oneLineFix(id, v) {
  const map = {
    'color-contrast': 'Raise foreground/background contrast to >=4.5:1 (>=3:1 for >=18pt or 14pt bold).',
    'color-contrast-enhanced': 'Raise contrast to >=7:1 (AAA) or accept AA where 4.5:1 already met.',
    label: 'Associate each input with a <label for=ID> or wrap it; aria-label/aria-labelledby acceptable.',
    'form-field-multiple-labels': 'Use exactly one programmatic label per field.',
    'label-title-only': 'Replace title-only labeling with a real <label> or aria-label.',
    'aria-valid-attr': 'Remove or correct the invalid aria-* attribute name.',
    'aria-valid-attr-value': 'Fix the aria attribute value (must match the attribute spec).',
    'aria-allowed-attr': 'Drop the disallowed aria attribute for this role.',
    'aria-required-attr': 'Add the missing required aria-* attribute for this role.',
    'aria-roles': 'Use a valid ARIA role token.',
    'aria-hidden-focus': 'Do not place focusable elements inside aria-hidden=true subtrees.',
    'button-name': 'Give the button accessible text (visible text, aria-label, or aria-labelledby).',
    'link-name': 'Give the link discernible text; avoid icon-only links without aria-label.',
    'image-alt': 'Add a meaningful alt attribute, or alt="" if decorative.',
    'landmark-one-main': 'Wrap primary content in a single <main> landmark.',
    'landmark-unique': 'Make each landmark of the same type uniquely labelled.',
    region: 'Ensure all content sits inside a landmark (header/nav/main/footer/aside/section[aria-label]).',
    bypass: 'Provide a skip-link or landmark to bypass repeated content.',
    'document-title': 'Set a unique, descriptive <title>.',
    'html-has-lang': 'Add a lang attribute on <html>.',
    'html-lang-valid': 'Use a valid BCP47 lang value.',
    'meta-viewport': 'Allow user scaling; do not set user-scalable=no or maximum-scale<2.',
    'duplicate-id': 'Make all id attributes unique on the page.',
    'duplicate-id-aria': 'Ensure aria-referenced ids are unique.',
    'duplicate-id-active': 'Ensure ids on focusable elements are unique.',
    'heading-order': 'Use sequential heading levels (no skipping h2 -> h4).',
    'empty-heading': 'Remove empty heading or give it text.',
    'list': 'Wrap <li> only inside <ul>/<ol>, no other intermediate elements.',
    'listitem': 'Place <li> only directly inside <ul> or <ol>.',
    'page-has-heading-one': 'Add a single <h1> per page.',
    'scrollable-region-focusable': 'Make scrollable regions focusable (tabindex=0).',
    'tabindex': 'Avoid tabindex > 0; rely on DOM order.',
    'focus-order-semantics': 'Give focusable elements an appropriate role (e.g. button vs div).',
    'nested-interactive': 'Do not nest interactive elements (e.g. <a> inside <button>).',
    'frame-title': 'Add a descriptive title attribute to every <iframe>.',
  };
  return map[id] || (v.help || 'See axe help URL.');
}

run().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
