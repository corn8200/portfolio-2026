import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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
  assert.doesNotMatch(cv, /dollar and percent figures are under NDA/i);
  assert.doesNotMatch(cv, /Color Code|KAI|Myers-Briggs/i);
  assert.doesNotMatch(cv, /operating principles came with me/i);
  assert.doesNotMatch(cv, /as much change management as it is engineering/i);
  assert.doesNotMatch(cv, /trust earned by performance/i);
  assert.match(cv, /\$1\.5B-plus roofing manufacturing space/i);
  assert.match(cv, /Cut unplanned downtime roughly 25 percent over an 18-month run/i);
  assert.match(cv, /roughly 3,500 rotary-wing flight hours/i);
});

test('army summary fixes duplicated article and lands stronger claim', () => {
  const army = read('content/projects/role-army-service.md');
  assert.doesNotMatch(army, /an an instructor/i);
  assert.match(army, /Standardization Instructor Pilot/i);
  assert.match(army, /signature put other pilots in the air/i);
  assert.match(army, /Roughly 3,500 rotary-wing flight hours/i);
  assert.match(army, /multi-million-dollar test-and-evaluation program/i);
});

test('paid role pages carry conservative impact numbers', () => {
  const aiLead = read('content/projects/role-tamko-ai-six-sigma-lead.md');
  const operations = read('content/projects/role-tamko-operations.md');
  assert.match(aiLead, /cut unplanned downtime roughly 25 percent over 18 months/i);
  assert.match(aiLead, /across all nine plants/i);
  assert.match(operations, /roughly 25 percent reduction in unplanned downtime over 18 months/i);
  assert.doesNotMatch(aiLead, /Impact numbers are documented internally/i);
  assert.doesNotMatch(operations, /Dollar and percent figures stay in internal documents/i);
});

test('work page removes education row and stack chip clouds', () => {
  const work = read('src/pages/work/index.astro');
  const list = read('src/components/ProjectList.astro');
  assert.match(work, /status !== 'credentialed'/);
  assert.match(work, /!p\.frontmatter\.hidden/);
  assert.doesNotMatch(work, /Eight systems in production/);
  assert.doesNotMatch(list, /proj-row__stack/);
});

test('hidden RAG topic files stay in corpus but out of work routes', () => {
  const topicFiles = readdirSync(new URL('../content/projects', import.meta.url))
    .filter((file) => file.startsWith('topic-') && file.endsWith('.md'))
    .sort();
  assert.deepEqual(topicFiles, [
    'topic-ai-rollout-failure-modes.md',
    'topic-faq.md',
    'topic-looking-for.md',
    'topic-multi-agent-workflow.md',
    'topic-narrative.md',
    'topic-operating-philosophy.md',
    'topic-stack-and-taste.md',
  ]);

  for (const file of topicFiles) {
    const topic = read(`content/projects/${file}`);
    assert.match(topic, /^hidden: true$/m);
    assert.match(topic, /^slug: ".+"$/m);
    assert.match(topic, /^summary: ".+"$/m);
  }

  const detail = read('src/pages/work/[slug].astro');
  const content = read('src/lib/content.ts');
  assert.match(detail, /getAllProjects\(\)\.filter\(\(p\) => !p\.frontmatter\.hidden\)/);
  assert.match(detail, /!project \|\| project\.frontmatter\.hidden/);
  assert.match(content, /hidden\?: boolean/);
});

test('portfolio case study is about Overseer, not the medium of this site', () => {
  const project = read('content/projects/project-this-site.md');
  assert.doesNotMatch(project, /This Site \(And What It Demonstrates\)/);
  assert.doesNotMatch(project, /The site is the demo/i);
  assert.match(project, /Overseer/i);
  assert.match(project, /slug: "operator-ai-system"/);
  assert.match(project, /order: 4/);
  assert.match(project, /links: \{\}/);
  assert.match(project, /Ten production services/i);
  assert.match(project, /Postgres LISTEN\/NOTIFY/i);
  assert.match(project, /Next\.js operator console/i);
  assert.match(project, /17,500 durable memories/i);
  assert.match(project, /65 proposed actions/i);
  assert.match(project, /mcp\.sentryaithermal\.com/i);
  assert.match(project, /Commitments I make in iMessage or voice/i);
  assert.match(project, /meeting in 20 minutes/i);
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
