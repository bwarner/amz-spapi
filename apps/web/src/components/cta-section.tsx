import Link from 'next/link';
import { ArrowRight, FileText, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function CTASection() {
  return (
    <section className="py-20 sm:py-24">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="grid gap-8 px-6 py-10 sm:px-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-end">
            <div className="space-y-4 text-center lg:text-left">
              <h2 className="text-3xl font-semibold tracking-tight text-foreground text-balance sm:text-4xl">
                Build the public-facing foundation before Amazon asks for it
              </h2>
              <p className="mx-auto max-w-2xl text-lg leading-8 text-muted-foreground text-pretty lg:mx-0">
                Sellavant now includes the public pages and product positioning
                needed for a more credible OAuth review posture, alongside the
                actual seller workflows you are building.
              </p>
              <div className="flex flex-wrap justify-center gap-3 lg:justify-start">
                <Button size="lg" asChild>
                  <Link href="/auth/login?screen_hint=signup&returnTo=/chat">
                    Open The Workspace
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button variant="outline" size="lg" asChild>
                  <Link href="/terms">Review Terms</Link>
                </Button>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-xl border bg-muted/30 p-4">
                <div className="flex items-center gap-3">
                  <FileText
                    className="h-5 w-5 text-primary"
                    aria-hidden="true"
                  />
                  <p className="font-medium text-foreground">
                    Public Site Coverage
                  </p>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  About, Privacy, Terms, Contact, and a cleaner homepage built
                  for a public application review.
                </p>
              </div>
              <div className="rounded-xl border bg-muted/30 p-4">
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-primary" aria-hidden="true" />
                  <p className="font-medium text-foreground">
                    Review-Oriented Positioning
                  </p>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Clear product scope, plain-language legal pages, and navigable
                  public information for prospective users and reviewers.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
