// Lightweight content loader. No Astro content collections — we read markdown
// at build time via Vite's `import.meta.glob`. Source of truth is /content/.
import type { MarkdownInstance } from 'astro';

export type ProjectFrontmatter = {
  title: string;
  slug: string;
  summary: string;
  stack?: string[];
  year?: string | number;
  status?: string;
  order?: number;
  links?: Record<string, string>;
};

export type ProjectEntry = {
  frontmatter: ProjectFrontmatter;
  url: string;
  rawContent: string;
  Content?: unknown;
};

// Eagerly load all project markdowns at build time.
const projectModules = import.meta.glob<MarkdownInstance<ProjectFrontmatter>>(
  '../../content/projects/*.md',
  { eager: true }
);

export function getAllProjects(): ProjectEntry[] {
  return Object.values(projectModules)
    .map((m) => ({
      frontmatter: m.frontmatter,
      url: `/work/${m.frontmatter.slug}/`,
      rawContent: (m as unknown as { rawContent?: () => string }).rawContent?.() ?? '',
      Content: m.Content,
    }))
    .sort((a, b) => {
      const ao = a.frontmatter.order ?? 99;
      const bo = b.frontmatter.order ?? 99;
      if (ao !== bo) return ao - bo;
      return String(a.frontmatter.title).localeCompare(String(b.frontmatter.title));
    });
}

export function getProjectBySlug(slug: string): ProjectEntry | undefined {
  return getAllProjects().find((p) => p.frontmatter.slug === slug);
}

// The CV source itself.
const cvSource = import.meta.glob<{ default: string }>('../../content/cv-source.md', {
  eager: true,
  query: '?raw',
  import: 'default',
});

export function getCvRaw(): string {
  const entry = Object.values(cvSource)[0] as unknown as string | undefined;
  return typeof entry === 'string' ? entry : '';
}
