import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const proofPoints = [
  'Amazon seller workflow focus',
  'A+ content builder & brand guides',
  'SP-API & Ads API connections',
];

export function HeroSection() {
  return (
    <section className="relative isolate overflow-hidden border-b bg-slate-950 text-white">
      <Image
        src="/modern-dashboard-interface-with-charts-and-analyti.jpg"
        alt="Sellavant workspace showing dashboards, charts, and Amazon workflow views"
        fill
        priority
        className="object-cover opacity-20"
        sizes="100vw"
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(45,212,191,0.18),transparent_32%),linear-gradient(180deg,rgba(15,23,42,0.52),rgba(2,6,23,0.9))]" />

      <div className="container relative mx-auto px-4 py-24 sm:px-6 sm:py-28 lg:py-32">
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <p className="inline-flex rounded-full border border-white/15 bg-white/5 px-3 py-1 text-sm font-medium text-white/80">
            Public-facing seller workflow platform
          </p>
          <h1 className="mx-auto mt-6 max-w-3xl text-center text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            Build better Amazon content packages with a cleaner AI workflow.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-center text-lg leading-8 text-slate-200 text-pretty">
            Sellavant helps your team collect product sources, organize brand
            rules, and turn raw assets into A+ content packages that are easier
            to review and publish.
          </p>

          <div className="mt-10 flex w-full flex-wrap justify-center gap-3">
            <Button size="lg" asChild>
              <Link href="/auth/login?screen_hint=signup&returnTo=/chat">
                Create Workspace
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
              asChild
            >
              <Link href="/about">Learn About Sellavant</Link>
            </Button>
          </div>

          <div className="mt-8 flex w-full flex-wrap justify-center gap-4 text-sm text-slate-200">
            {proofPoints.map((point) => (
              <div
                key={point}
                className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-2"
              >
                <CheckCircle2
                  className="h-4 w-4 text-teal-300"
                  aria-hidden="true"
                />
                <span>{point}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
