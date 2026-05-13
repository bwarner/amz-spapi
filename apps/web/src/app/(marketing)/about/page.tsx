import type { Metadata } from 'next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BookTemplate, Link2, ShieldCheck } from 'lucide-react';

export const metadata: Metadata = {
  title: 'About',
  description:
    'Learn what Sellavant is building for Amazon sellers, brand workflows, and AI-assisted A+ content operations.',
};

const principles = [
  {
    icon: Link2,
    title: 'Source-Aware By Design',
    description:
      'The workflow starts with the real materials teams already use: listing pages, supplier links, PDFs, brand decks, logos, and raw product imagery.',
  },
  {
    icon: BookTemplate,
    title: 'Reusable Brand Systems',
    description:
      'Brand guides should not be rebuilt for every project. Sellavant keeps brand rules reusable across A+ content, listings, and future creative workflows.',
  },
  {
    icon: ShieldCheck,
    title: 'Production-Ready Foundations',
    description:
      'Public-facing legal pages, reviewable OAuth posture, and explicit account connections matter when a prototype needs to become a real product.',
  },
];

export default function AboutPage() {
  return (
    <div className="container max-w-5xl px-4 py-16 sm:px-6">
      <div className="max-w-3xl">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground text-balance">
          Sellavant is building a better workflow for Amazon content operations
        </h1>
        <p className="mt-6 text-lg leading-8 text-muted-foreground text-pretty">
          Amazon creative work is usually spread across listing pages, supplier
          assets, brand decks, screenshots, and a trail of half-finished
          documents. Sellavant brings those inputs into a single workspace so
          your team can shape reusable brand guides and produce cleaner A+
          content packages with AI support.
        </p>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-3">
        {principles.map((principle) => (
          <Card
            key={principle.title}
            className="border-border/70 bg-card shadow-sm"
          >
            <CardHeader className="space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <principle.icon
                  className="h-6 w-6 text-primary"
                  aria-hidden="true"
                />
              </div>
              <CardTitle className="text-xl">{principle.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-base leading-7 text-muted-foreground">
                {principle.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="space-y-5">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            What the product does
          </h2>
          <p className="text-muted-foreground leading-7">
            Sellavant helps organize seller workflows around connected Amazon
            accounts, authorized Brand Analytics reports, uploaded assets,
            public or supplier source links, saved drafts, and reusable brand
            guide data. The current product direction is centered on analytics,
            A+ content creation, and the operational work needed to turn seller
            data into reviewed marketplace improvements.
          </p>
          <p className="text-muted-foreground leading-7">
            Rather than generating one giant block of content and leaving users
            to manually cut it apart, the product is moving toward a more
            structured package model: source intake, brand-aware rules, draft
            persistence, and reviewable outputs that map better to how Amazon
            teams actually work.
          </p>
        </section>

        <section className="space-y-5 rounded-2xl border bg-muted/20 p-6">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            How Sellavant works
          </h2>
          <ul className="space-y-3 text-muted-foreground">
            <li>
              Connect seller or advertising accounts when they are available.
            </li>
            <li>
              Review authorized Brand Analytics and account-level seller data.
            </li>
            <li>
              Upload style guides, logos, source files, and product assets.
            </li>
            <li>
              Extract brand cues like colors, fonts, and notes from those
              materials.
            </li>
            <li>
              Save reusable brand guides and apply them inside A+ drafting
              workflows.
            </li>
            <li>
              Keep drafts and supporting context together so teams can return
              later.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
