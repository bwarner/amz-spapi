import type { Metadata } from 'next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Mail, ShieldAlert, Sparkles } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Contact Sellavant for product questions, support, and privacy or legal requests.',
};

const contactCards = [
  {
    icon: Mail,
    title: 'Product & Support',
    email: 'support@sellavant.com',
    description:
      'Questions about the product, account access, or current workflow behavior.',
  },
  {
    icon: Sparkles,
    title: 'Feature Requests',
    email: 'feedback@sellavant.com',
    description:
      'Ideas for A+ content workflows, brand guide improvements, or future integrations.',
  },
  {
    icon: ShieldAlert,
    title: 'Privacy & Legal',
    email: 'privacy@sellavant.com',
    description:
      'Privacy questions, deletion requests, or legal inquiries related to the service.',
  },
];

export default function ContactPage() {
  return (
    <div className="container max-w-5xl px-4 py-16 sm:px-6">
      <div className="max-w-3xl">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground text-balance">
          Contact Sellavant
        </h1>
        <p className="mt-6 text-lg leading-8 text-muted-foreground text-pretty">
          Use the addresses below for support, feature planning, or
          privacy-related requests. If a message is sent to the wrong inbox, it
          can still be routed internally.
        </p>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-3">
        {contactCards.map((card) => (
          <Card key={card.title} className="border-border/70 bg-card shadow-sm">
            <CardHeader className="space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <card.icon
                  className="h-6 w-6 text-primary"
                  aria-hidden="true"
                />
              </div>
              <CardTitle className="text-xl">{card.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm leading-6 text-muted-foreground">
                {card.description}
              </p>
              <a
                href={`mailto:${card.email}`}
                className="font-medium text-primary hover:underline"
              >
                {card.email}
              </a>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
