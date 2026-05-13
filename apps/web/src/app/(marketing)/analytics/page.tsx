import type { Metadata } from 'next';
import Link from 'next/link';
import { BarChart3, Database, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Amazon Seller Analytics',
  description:
    'Sellavant analytics services for authorized Amazon Selling Partners, including Brand Analytics workflows, seller reporting, and compliance boundaries.',
};

const analyticsServices = [
  {
    title: 'Brand Analytics Reporting',
    description:
      'Organize Brand Analytics outputs such as search query performance, search catalog performance, market basket analysis, repeat purchase behavior, and brand-level customer behavior reports when those reports are available to the authorized Selling Partner.',
  },
  {
    title: 'Search & Content Opportunity Analysis',
    description:
      'Help sellers identify search terms, ASINs, content gaps, and listing improvement opportunities for their own brands and authorized catalog only.',
  },
  {
    title: 'Performance Monitoring',
    description:
      'Track account-specific trends across authorized sales, catalog, advertising, and brand data so operators can prioritize listing, A+ content, and merchandising work.',
  },
  {
    title: 'AI-Assisted Summaries',
    description:
      'Summarize seller-authorized analytics into reviewable recommendations. Sellers remain responsible for approving final business decisions, claims, and marketplace submissions.',
  },
];

const dataSources = [
  'Brand Analytics reports available to the authorized Selling Partner',
  'Seller account, marketplace, catalog, listing, and sales data authorized through Amazon SP-API',
  'Advertising performance data authorized through Amazon Ads API where connected',
  'Customer-provided assets, source links, brand guides, and product materials',
];

const boundaries = [
  'No aggregation of SP-API data across Selling Partners, businesses, or Amazon customers to provide or sell benchmarks, rankings, datasets, or competitive intelligence.',
  'No calculation, promotion, publication, or sale of insights about Amazon business performance, Amazon marketplace health, Amazon strategy, or Amazon internal operations.',
  'No resale of Amazon data, no data vending, and no external audience targeting using Amazon customer data.',
  'Analytics are scoped to the specific seller, brand, marketplaces, and data permissions authorized by that Selling Partner.',
];

export default function AnalyticsPage() {
  return (
    <div className="bg-background">
      <section className="border-b bg-muted/20">
        <div className="container mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="max-w-3xl">
            <Badge variant="outline">Amazon Selling Partner analytics</Badge>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-foreground text-balance sm:text-5xl">
              Brand Analytics and seller reporting for authorized Amazon sellers
            </h1>
            <p className="mt-6 text-lg leading-8 text-muted-foreground text-pretty">
              Sellavant helps Amazon Selling Partners turn authorized Brand
              Analytics, catalog, advertising, and workflow data into clear
              operator actions for their own brands and seller accounts.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/pricing">View Pricing</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/contact">Contact Support</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="container mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {analyticsServices.map((service) => (
            <Card key={service.title} className="border-border/70 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-3 text-xl">
                  <BarChart3 className="h-5 w-5 text-primary" aria-hidden />
                  {service.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="leading-7 text-muted-foreground">
                  {service.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y bg-muted/20">
        <div className="container mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <div className="flex items-center gap-3">
              <Database className="h-6 w-6 text-primary" aria-hidden />
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                Data used for analytics
              </h2>
            </div>
            <p className="mt-4 leading-7 text-muted-foreground">
              Sellavant uses only data authorized by the Selling Partner and
              only for the seller workflows described on this site.
            </p>
            <ul className="mt-6 space-y-3 text-muted-foreground">
              {dataSources.map((source) => (
                <li key={source} className="flex gap-3 leading-7">
                  <ShieldCheck
                    className="mt-1 h-5 w-5 shrink-0 text-secondary"
                    aria-hidden
                  />
                  <span>{source}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="flex items-center gap-3">
              <LockKeyhole className="h-6 w-6 text-primary" aria-hidden />
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                Acceptable use boundaries
              </h2>
            </div>
            <p className="mt-4 leading-7 text-muted-foreground">
              Sellavant is designed to support Amazon&apos;s Acceptable Use
              Policy, including the restrictions in sections 4.4 and 4.5.
            </p>
            <ul className="mt-6 space-y-3 text-muted-foreground">
              {boundaries.map((boundary) => (
                <li key={boundary} className="flex gap-3 leading-7">
                  <ShieldCheck
                    className="mt-1 h-5 w-5 shrink-0 text-secondary"
                    aria-hidden
                  />
                  <span>{boundary}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="container mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-start">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              Example seller workflows
            </h2>
            <div className="mt-6 grid gap-4">
              {[
                'Review search query performance to find terms where an authorized brand has visibility but weak conversion.',
                "Compare an authorized ASIN against the seller's own content and advertising context to prioritize A+ content improvements.",
                "Summarize market basket and repeat purchase patterns for the seller's own eligible brands without exposing other sellers' data.",
                'Turn authorized analytics into task lists for listing content, brand guide updates, and advertising review.',
              ].map((workflow) => (
                <div key={workflow} className="rounded-lg border bg-card p-4">
                  <p className="leading-7 text-muted-foreground">{workflow}</p>
                </div>
              ))}
            </div>
          </div>

          <Card className="border-border/70 shadow-sm">
            <CardHeader>
              <CardTitle>Important limitations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-muted-foreground">
              <p className="leading-7">
                Sellavant does not provide public marketplace benchmarks,
                cross-seller rankings, Amazon business intelligence, or datasets
                derived from multiple sellers&apos; SP-API data.
              </p>
              <p className="leading-7">
                All analytical outputs are intended for the authorized seller
                account that connected the data and are subject to review before
                operational use.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
