import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BadgeCheck, Database, WandSparkles } from 'lucide-react';

const steps = [
  {
    icon: BadgeCheck,
    step: '1',
    title: 'Set Up Access',
    description:
      'Create your workspace, connect available Amazon accounts, and confirm the legal and privacy information required for production access.',
  },
  {
    icon: Database,
    step: '2',
    title: 'Add Sources',
    description:
      'Upload raw product photos, polished assets, logos, PDFs, and source links so the system has the same context your creative team uses.',
  },
  {
    icon: WandSparkles,
    step: '3',
    title: 'Build The Package',
    description:
      'Use brand guides and AI-assisted drafting to shape A+ content packages, review modules, and keep revisions saved as reusable drafts.',
  },
];

export function GettingStartedSection() {
  return (
    <section id="workflow" className="border-y bg-muted/20 py-20 sm:py-24">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground text-balance sm:text-4xl">
            A workflow that starts with source material, not assumptions
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-8 text-muted-foreground text-pretty">
            Public OAuth, legal pages, brand rules, and content assembly all
            need to work together if the app is going to survive real seller
            review and production use.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {steps.map((step) => (
            <Card
              key={step.step}
              className="border-border/70 bg-background text-center shadow-sm"
            >
              <CardHeader className="space-y-4">
                <div className="flex items-center justify-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-secondary/15">
                    <step.icon
                      className="h-6 w-6 text-secondary"
                      aria-hidden="true"
                    />
                  </div>
                  <span className="text-sm font-semibold text-muted-foreground">
                    {step.step}
                  </span>
                </div>
                <CardTitle className="text-xl">{step.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-base leading-7 text-muted-foreground">
                  {step.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
