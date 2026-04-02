import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service — Sellavant',
  description: 'Terms and conditions for using the Sellavant platform.',
}

export default function TermsPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: March 29, 2026</p>

      <div className="mt-8 space-y-8 text-muted-foreground leading-relaxed">
        <section>
          <h2 className="text-xl font-semibold text-foreground">1. Acceptance of Terms</h2>
          <p className="mt-3">
            By accessing or using Sellavant (&quot;the Service&quot;), you agree to be bound by these Terms
            of Service. If you do not agree, do not use the Service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">2. Description of Service</h2>
          <p className="mt-3">
            Sellavant is an AI-powered assistant for Amazon sellers. The Service provides tools to
            analyze product listings, review orders, monitor inventory, and optimize advertising
            campaigns by connecting to your Amazon Seller Central and Amazon Advertising accounts
            via official Amazon APIs.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">3. Account Requirements</h2>
          <ul className="mt-3 list-disc pl-6 space-y-1">
            <li>You must be at least 18 years old to use the Service</li>
            <li>You must have a valid Amazon Seller Central or Amazon Advertising account</li>
            <li>You are responsible for maintaining the confidentiality of your account credentials</li>
            <li>You are responsible for all activities under your account</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">4. Amazon Account Authorization</h2>
          <p className="mt-3">
            By connecting your Amazon account, you authorize Sellavant to access your seller data
            through Amazon&apos;s official APIs (SP-API and Ads API). This authorization is governed by
            Amazon&apos;s Developer Agreement and Acceptable Use Policy. You may revoke this authorization
            at any time through your Amazon Seller Central settings or our settings page.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">5. Acceptable Use</h2>
          <p className="mt-3">You agree not to:</p>
          <ul className="mt-2 list-disc pl-6 space-y-1">
            <li>Use the Service to violate Amazon&apos;s terms of service or policies</li>
            <li>Attempt to access data belonging to other sellers</li>
            <li>Use the Service for any unlawful purpose</li>
            <li>Reverse engineer or attempt to extract source code from the Service</li>
            <li>Share your account with unauthorized third parties</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">6. AI-Generated Content</h2>
          <p className="mt-3">
            The Service uses artificial intelligence to analyze your data and provide recommendations.
            AI-generated suggestions (including listing optimization, keyword recommendations, and
            business insights) are provided as guidance only. You are responsible for reviewing and
            approving any changes before applying them to your Amazon listings or campaigns.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">7. Data Handling</h2>
          <p className="mt-3">
            Our handling of your data is described in our{' '}
            <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>.
            We cache Amazon API data temporarily to improve performance and comply with Amazon&apos;s
            rate limits. Personally identifiable buyer information is never stored.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">8. Limitation of Liability</h2>
          <p className="mt-3">
            The Service is provided &quot;as is&quot; without warranty of any kind. Sellavant is not responsible
            for any losses, damages, or negative outcomes resulting from actions taken based on
            AI-generated recommendations, Amazon API downtime, or data inaccuracies.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">9. Termination</h2>
          <p className="mt-3">
            We may suspend or terminate your account at any time for violation of these terms. You
            may terminate your account at any time by contacting us. Upon termination, your stored
            credentials and cached data will be deleted.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">10. Changes to Terms</h2>
          <p className="mt-3">
            We may update these terms from time to time. Continued use of the Service after changes
            constitutes acceptance of the updated terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">11. Contact</h2>
          <p className="mt-3">
            Questions about these terms? Contact us at{' '}
            <a href="mailto:legal@sellavant.com" className="text-primary hover:underline">
              legal@sellavant.com
            </a>.
          </p>
        </section>
      </div>
    </div>
  )
}
