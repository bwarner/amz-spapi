import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    'Terms governing access to the Sellavant platform and connected workflows.',
};

const lastUpdated = 'April 23, 2026';

export default function TermsPage() {
  return (
    <div className="container max-w-4xl px-4 py-16 sm:px-6">
      <div className="max-w-3xl">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground text-balance">
          Terms of Service
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Last updated {lastUpdated}
        </p>
        <p className="mt-6 text-lg leading-8 text-muted-foreground text-pretty">
          These terms govern access to the Sellavant product, website, and
          connected account workflows. By using the service, the user agrees to
          these terms.
        </p>
      </div>

      <div className="mt-12 space-y-10 text-muted-foreground">
        <section className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            1. Service Scope
          </h2>
          <p className="leading-7">
            Sellavant provides software that helps users organize source
            materials, maintain brand guides, connect Amazon-related accounts
            where authorized, and generate AI-assisted draft outputs for seller
            workflows such as A+ content preparation.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            2. Accounts
          </h2>
          <p className="leading-7">
            Users are responsible for maintaining the confidentiality of their
            login credentials and for all activity that occurs under their
            account. Users must provide accurate account information and may
            only use the service for lawful business purposes.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            3. Connected Platforms
          </h2>
          <p className="leading-7">
            When users connect third-party services, including Amazon seller or
            advertising accounts, Sellavant may access the scopes and data
            explicitly authorized through those workflows. Users remain
            responsible for ensuring they have the authority to connect the
            accounts and to use the resulting data inside their organization.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            4. User Content
          </h2>
          <p className="leading-7">
            Users may upload logos, PDFs, style guides, product assets,
            screenshots, and other materials. Users retain responsibility for
            the legality, accuracy, and permissions associated with those
            materials. Sellavant may process uploaded materials to extract
            structured suggestions for brand guides and draft workflows.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            5. AI-Assisted Output
          </h2>
          <p className="leading-7">
            AI-assisted responses, extracted suggestions, and generated drafts
            are provided to help users work faster. Users remain responsible for
            reviewing and approving any final content, legal claims, product
            messaging, or marketplace submissions before publication.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            6. Acceptable Use
          </h2>
          <ul className="list-disc space-y-2 pl-6 leading-7">
            <li>
              Do not use the service to violate marketplace rules or third-party
              terms.
            </li>
            <li>Do not upload materials you are not authorized to use.</li>
            <li>
              Do not attempt to access other users&apos; accounts or data.
            </li>
            <li>
              Do not use the service for unlawful, deceptive, or abusive
              activity.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            7. Availability & Changes
          </h2>
          <p className="leading-7">
            Sellavant may change, improve, suspend, or remove features from time
            to time. Access to third-party integrations may also change based on
            provider policies, review status, or account configuration.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            8. Warranty Disclaimer
          </h2>
          <p className="leading-7">
            The service is provided on an “as is” and “as available” basis. To
            the maximum extent permitted by law, Sellavant disclaims warranties
            of merchantability, fitness for a particular purpose, and
            non-infringement.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            9. Limitation of Liability
          </h2>
          <p className="leading-7">
            Sellavant is not liable for indirect, incidental, special,
            consequential, or punitive damages arising out of or related to use
            of the service. Users remain responsible for business decisions and
            published content.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            10. Privacy
          </h2>
          <p className="leading-7">
            Use of the service is also governed by the{' '}
            <Link href="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            11. Contact
          </h2>
          <p className="leading-7">
            Questions about these terms can be sent to{' '}
            <a
              href="mailto:legal@sellavant.com"
              className="text-primary hover:underline"
            >
              legal@sellavant.com
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
