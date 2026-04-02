import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy — Sellavant',
  description: 'How Sellavant collects, uses, and protects your data.',
}

export default function PrivacyPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: March 29, 2026</p>

      <div className="mt-8 space-y-8 text-muted-foreground leading-relaxed">
        <section>
          <h2 className="text-xl font-semibold text-foreground">1. Information We Collect</h2>
          <p className="mt-3">
            When you create an account via Auth0, we collect your name, email address, and profile
            information. When you connect your Amazon seller account, we receive an OAuth refresh
            token that allows us to access your Amazon data on your behalf.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">2. How We Use Your Information</h2>
          <p className="mt-3">We use your information to:</p>
          <ul className="mt-2 list-disc pl-6 space-y-1">
            <li>Provide the Sellavant AI assistant and dashboard features</li>
            <li>Access your Amazon catalog, orders, inventory, and advertising data via SP-API and Ads API</li>
            <li>Cache API responses temporarily to improve performance and respect Amazon rate limits</li>
            <li>Communicate with you about your account and service updates</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">3. Amazon Data Handling</h2>
          <p className="mt-3">
            We access your Amazon data through the official Selling Partner API (SP-API) and Amazon
            Advertising API. We comply with Amazon&apos;s Developer Agreement and Acceptable Use Policy:
          </p>
          <ul className="mt-2 list-disc pl-6 space-y-1">
            <li>Personally identifiable information (PII) such as buyer names and addresses is never stored or cached</li>
            <li>Non-PII catalog and order data is cached temporarily with automatic expiration</li>
            <li>Your OAuth tokens are stored securely and used only to access data you have authorized</li>
            <li>You can revoke access at any time through your Amazon Seller Central account or our settings page</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">4. Data Storage and Security</h2>
          <p className="mt-3">
            Your data is stored in Couchbase databases hosted on secure cloud infrastructure. Authentication
            is managed by Auth0, a trusted identity provider. We use HTTPS for all data transmission.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">5. Cookies</h2>
          <p className="mt-3">
            We use essential cookies for authentication session management (Auth0) and CSRF protection
            during the Amazon OAuth connect flow. We do not use tracking or advertising cookies.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">6. Third-Party Services</h2>
          <p className="mt-3">We use the following third-party services:</p>
          <ul className="mt-2 list-disc pl-6 space-y-1">
            <li><strong>Auth0</strong> — Authentication and identity management</li>
            <li><strong>Amazon SP-API &amp; Ads API</strong> — Access to your Amazon seller data</li>
            <li><strong>Vercel</strong> — Application hosting</li>
            <li><strong>AWS</strong> — Cloud infrastructure and AI services (Amazon Bedrock)</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">7. Your Rights</h2>
          <p className="mt-3">
            You have the right to access, correct, or delete your personal data. You can disconnect
            your Amazon account at any time, which will remove your stored credentials. To request
            data deletion, contact us at{' '}
            <a href="mailto:privacy@sellavant.com" className="text-primary hover:underline">
              privacy@sellavant.com
            </a>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">8. Contact Us</h2>
          <p className="mt-3">
            For privacy-related questions, contact us at{' '}
            <a href="mailto:privacy@sellavant.com" className="text-primary hover:underline">
              privacy@sellavant.com
            </a>.
          </p>
        </section>
      </div>
    </div>
  )
}
