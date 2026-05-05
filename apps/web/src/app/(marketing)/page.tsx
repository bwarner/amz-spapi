import type { Metadata } from 'next';
import { HeroSection } from '@/components/hero-section';
import { FeaturesSection } from '@/components/features-section';
import { GettingStartedSection } from '@/components/getting-started-section';
import { CTASection } from '@/components/cta-section';

export const metadata: Metadata = {
  title: 'Sellavant',
  description:
    'Sellavant is a professional AI workspace for Amazon sellers building A+ content, brand guides, and connected workflow tooling.',
};

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <HeroSection />
      <FeaturesSection />
      <GettingStartedSection />
      <CTASection />
    </div>
  );
}
