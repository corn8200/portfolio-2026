import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('home leads with agent and proof instead of navigation doors', () => {
  const home = read('src/pages/index.astro');
  for (const proof of ['9 plants', '20 yr', '2 promotions']) {
    assert.match(home, new RegExp(proof));
  }
  assert.match(home, /<VoiceAgent\s*\/>/);
  assert.match(home, /Industrial AI operator/);
  assert.doesNotMatch(home, /class="doors"/);
  assert.doesNotMatch(home, />Talk to me</);
  assert.doesNotMatch(home, />Read the CV</);
  assert.doesNotMatch(home, />See the career</);
});

test('cv copy removes weak or incorrect lines', () => {
  const cv = read('content/cv-source.md');
  assert.doesNotMatch(cv, /Specific figures available in private conversation/i);
  assert.doesNotMatch(cv, /Color Code|KAI|Myers-Briggs/i);
  assert.doesNotMatch(cv, /operating principles came with me/i);
  assert.doesNotMatch(cv, /as much change management as it is engineering/i);
  assert.doesNotMatch(cv, /trust earned by performance/i);
});

test('army summary fixes duplicated article and lands stronger claim', () => {
  const army = read('content/projects/role-army-service.md');
  assert.doesNotMatch(army, /an an instructor/i);
  assert.match(army, /Standardization Instructor Pilot/i);
  assert.match(army, /signature put other pilots in the air/i);
});

test('work page removes education row and stack chip clouds', () => {
  const work = read('src/pages/work/index.astro');
  const list = read('src/components/ProjectList.astro');
  assert.match(work, /status !== 'credentialed'/);
  assert.doesNotMatch(work, /Eight systems in production/);
  assert.doesNotMatch(list, /proj-row__stack/);
});

test('portfolio case study is about Overseer, not the medium of this site', () => {
  const project = read('content/projects/project-this-site.md');
  assert.doesNotMatch(project, /This Site \(And What It Demonstrates\)/);
  assert.doesNotMatch(project, /The site is the demo/i);
  assert.match(project, /Overseer/i);
  assert.match(project, /Command bus/i);
  assert.match(project, /Cockpit/i);
  assert.match(project, /17\.5K durable memories/i);
  assert.match(project, /65 proposed actions/i);
  assert.match(project, /mcp\.sentryaithermal\.com/i);
  assert.match(project, /Commitments I make in iMessage or voice/i);
  assert.match(project, /meeting-in-N-minutes push/i);
  assert.match(project, /stale meeting on a colleague sick-day/i);
  assert.doesNotMatch(project, /^stack:/m);
  assert.doesNotMatch(project, /Why it belongs on a CV|## Why it matters/i);
});

test('voice agent is direct, not hidden behind the wizard', () => {
  const agent = read('src/components/VoiceAgent.astro');
  assert.doesNotMatch(agent, /OnboardingWizard/);
  assert.doesNotMatch(agent, /onboarding-client/);
  assert.match(agent, /Ask John/i);
});

test('footer and contact posture are direct', () => {
  const footer = read('src/components/SiteFooter.astro');
  const layout = read('src/layouts/BaseLayout.astro');
  assert.doesNotMatch(footer, /available for conversations/i);
  assert.match(footer, /open to AI\/ops roles/i);
  assert.match(layout, /showFooter/);
});
