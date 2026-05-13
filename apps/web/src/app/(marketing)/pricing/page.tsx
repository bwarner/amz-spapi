import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Sellavant pricing for Amazon seller analytics, Brand Analytics workflows, and AI-assisted content operations.',
};

const included = [
  'Authorized Amazon SP-API connection support',
  'Brand Analytics and seller reporting workflows',
  'A+ content and brand guide workspace',
  'AI-assisted summaries and draft recommendations',
  'Email support during onboarding and pilot use',
];

const factors = [
  'Number of seller accounts, marketplaces, and brands connected',
  'Brand Analytics report scope and refresh frequency',
  'Catalog, ASIN, and advertising workflow volume',
  'Custom onboarding, data migration, or implementation support',
];

export default function PricingPage() {
  return (
    <div className="container mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
      <div className="max-w-3xl">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground text-balance sm:text-5xl">
          Pricing for Amazon seller analytics and workflow automation
        </h1>
        <p className="mt-6 text-lg leading-8 text-muted-foreground text-pretty">
          Sellavant is currently offered through quote-based pilot plans for
          Amazon sellers and operators that need Brand Analytics reporting,
          connected workflow tooling, and AI-assisted content operations.
        </p>
      </div>

      <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card className="border-border/70 shadow-sm">
          <CardHeader>
            <p className="text-sm font-medium text-primary">Pilot plan</p>
            <CardTitle className="text-3xl">
              Quote-based monthly pricing
            </CardTitle>
            <p className="pt-2 text-muted-foreground">
              Pricing is based on the authorized seller accounts, marketplaces,
              report scope, workflow volume, and implementation support needed.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-lg border bg-muted/30 p-5">
              <p className="text-sm font-medium text-foreground">
                Typical starting point
              </p>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                $299/month
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Final pricing is confirmed before onboarding and may vary by
                data scope, connected accounts, and custom support needs.
              </p>
            </div>

            <ul className="space-y-3 text-muted-foreground">
              {included.map((item) => (
                <li key={item} className="flex gap-3 leading-7">
                  <CheckCircle2
                    className="mt-1 h-5 w-5 shrink-0 text-secondary"
                    aria-hidden
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/contact">Request Pricing</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/analytics">Review Analytics Services</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-border/70 shadow-sm">
            <CardHeader>
              <CardTitle>What affects price</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 text-muted-foreground">
                {factors.map((factor) => (
                  <li key={factor} className="flex gap-3 leading-7">
                    <CheckCircle2
                      className="mt-1 h-5 w-5 shrink-0 text-secondary"
                      aria-hidden
                    />
                    <span>{factor}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-sm">
            <CardHeader>
              <CardTitle>No resale or benchmark data products</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-muted-foreground">
              <p className="leading-7">
                Sellavant pricing covers software and support for the authorized
                seller&apos;s own workflows. It does not include selling
                cross-seller datasets, marketplace benchmarks, or insights about
                Amazon&apos;s business.
              </p>
              <p className="leading-7">
                Sellers can disconnect Amazon accounts and request deletion of
                stored workflow data as described in the Privacy Policy.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
