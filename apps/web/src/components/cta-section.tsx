import Link from 'next/link';
import { ArrowRight, BarChart3, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function CTASection() {
  return (
    <section className="py-20 sm:py-24">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="grid gap-8 px-6 py-10 sm:px-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-end">
            <div className="space-y-4 text-center lg:text-left">
              <h2 className="text-3xl font-semibold tracking-tight text-foreground text-balance sm:text-4xl">
                Turn Amazon seller data into the next useful action
              </h2>
              <p className="mx-auto max-w-2xl text-lg leading-8 text-muted-foreground text-pretty lg:mx-0">
                Use authorized Brand Analytics, catalog, advertising, and
                product-source context to prioritize content, listing, and
                merchandising work for your own seller account.
              </p>
              <div className="flex flex-wrap justify-center gap-3 lg:justify-start">
                <Button size="lg" asChild>
                  <Link href="/analytics">
                    Review Analytics Services
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button variant="outline" size="lg" asChild>
                  <Link href="/pricing">View Pricing</Link>
                </Button>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-xl border bg-muted/30 p-4">
                <div className="flex items-center gap-3">
                  <BarChart3
                    className="h-5 w-5 text-primary"
                    aria-hidden="true"
                  />
                  <p className="font-medium text-foreground">
                    Seller-Scoped Analytics
                  </p>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Search, catalog, advertising, and brand reports stay tied to
                  the seller account that authorized access.
                </p>
              </div>
              <div className="rounded-xl border bg-muted/30 p-4">
                <div className="flex items-center gap-3">
                  <ShieldCheck
                    className="h-5 w-5 text-primary"
                    aria-hidden="true"
                  />
                  <p className="font-medium text-foreground">
                    Authorized Connections
                  </p>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Connect Amazon accounts only through seller-approved access,
                  with clear limits on how Amazon data is used.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
