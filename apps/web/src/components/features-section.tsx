import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { BookTemplate, Files, Link2, ShieldCheck } from 'lucide-react';

const features = [
  {
    icon: Files,
    title: 'Source Collection',
    description:
      'Bring in listing pages, supplier links, competitor references, raw product photography, and polished assets in one workspace.',
  },
  {
    icon: BookTemplate,
    title: 'Brand Guide Workspace',
    description:
      'Store logos, colors, fonts, usage notes, and source guidelines so creative decisions stay reusable across future A+ packages.',
  },
  {
    icon: Link2,
    title: 'AI-Assisted Packaging',
    description:
      'Turn scattered source material into structured A+ drafts with module planning, extracted suggestions, and saved work-in-progress drafts.',
  },
  {
    icon: ShieldCheck,
    title: 'Account-Aware Integrations',
    description:
      'Connect Amazon seller and advertising accounts when available, while still supporting manual creative workflows when they are not.',
  },
];

export function FeaturesSection() {
  return (
    <section id="product" className="py-20 sm:py-24">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground text-balance sm:text-4xl">
            A product surface built for actual Amazon content work
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-8 text-muted-foreground text-pretty">
            Sellavant is designed for the messy middle of e-commerce creative
            work: collecting inputs, shaping brand rules, and preparing
            publishable A+ packages without losing the source context along the
            way.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {features.map((feature) => (
            <Card
              key={feature.title}
              className="border-border/70 bg-card text-center shadow-sm"
            >
              <CardHeader className="space-y-4">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <feature.icon
                    className="h-6 w-6 text-primary"
                    aria-hidden="true"
                  />
                </div>
                <div className="space-y-2">
                  <CardTitle className="text-xl">{feature.title}</CardTitle>
                  <CardDescription className="text-base leading-7 text-muted-foreground">
                    {feature.description}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent />
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
