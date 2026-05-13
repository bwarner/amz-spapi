import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How Sellavant collects, uses, stores, and deletes account and workflow data.',
};

const lastUpdated = 'April 23, 2026';

export default function PrivacyPage() {
  return (
    <div className="container max-w-4xl px-4 py-16 sm:px-6">
      <div className="max-w-3xl">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground text-balance">
          Privacy Policy
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Last updated {lastUpdated}
        </p>
        <p className="mt-6 text-lg leading-8 text-muted-foreground text-pretty">
          This policy explains what information Sellavant collects, how that
          information is used, and how users can request access, correction, or
          deletion.
        </p>
      </div>

      <div className="mt-12 space-y-10 text-muted-foreground">
        <section className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            1. Information Collected
          </h2>
          <p className="leading-7">
            Sellavant may collect account information such as name, email
            address, and identity provider profile details during
            authentication. When users connect Amazon accounts, Sellavant may
            store authorized credentials, account identifiers, marketplace
            selections, advertiser profile identifiers, and related connection
            metadata.
          </p>
          <p className="leading-7">
            Sellavant may also store user-provided workflow materials such as
            uploaded assets, product photos, style guides, logos, source links,
            brand guide notes, and A+ draft data.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            2. How Information Is Used
          </h2>
          <ul className="list-disc space-y-2 pl-6 leading-7">
            <li>
              Provide the workspace, draft-saving, and brand guide features.
            </li>
            <li>
              Access Amazon seller or advertising data that the user has
              explicitly authorized.
            </li>
            <li>
              Generate AI-assisted suggestions from uploaded files and source
              materials.
            </li>
            <li>
              Diagnose connection health, improve reliability, and respond to
              support requests.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            3. Amazon Data Handling
          </h2>
          <p className="leading-7">
            Sellavant is designed to work with official Amazon APIs such as the
            Selling Partner API and Amazon Advertising API. Access is limited to
            scopes and account data authorized by the user. OAuth credentials
            are stored for authorized access only. Amazon data is used to
            provide seller-authorized analytics, reporting, content, and
            workflow features for the connected seller account.
          </p>
          <p className="leading-7">
            Sellavant does not aggregate SP-API data across Selling Partners,
            businesses, or Amazon customers to provide or sell datasets,
            benchmarks, rankings, or competitive intelligence. Sellavant does
            not calculate, promote, publish, or sell insights about
            Amazon&apos;s business, marketplace health, strategy, or internal
            operations. Personally identifiable buyer data should not be
            retained beyond what is necessary to operate the authorized
            workflow, and some sensitive categories are intentionally excluded
            from caching or draft storage.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            4. Data Protection
          </h2>
          <p className="leading-7">
            Sellavant uses HTTPS for data in transit, environment-based secret
            configuration, access controls, and encrypted credential storage for
            authorized Amazon connections. Access to stored workflow data is
            limited to the systems and personnel needed to operate, support, and
            secure the service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            5. Uploaded Files & Source Links
          </h2>
          <p className="leading-7">
            Brand guides, logos, source files, screenshots, and linked public
            pages may be stored so users can return to drafts later. Public
            links may be fetched server-side to extract brand cues such as
            colors, notes, and font candidates. Users should only upload or link
            materials they are authorized to use.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            6. Sharing & Service Providers
          </h2>
          <p className="leading-7">
            Sellavant relies on third-party infrastructure providers for
            hosting, storage, authentication, and AI processing. Those providers
            may process information on Sellavant&apos;s behalf to operate the
            service. Sellavant does not sell user data.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            7. Retention & Deletion
          </h2>
          <p className="leading-7">
            Sellavant retains account data, saved drafts, and uploaded materials
            only as long as they are needed to operate the service, fulfill
            support obligations, or satisfy lawful retention requirements. Users
            may request deletion of their account data and stored materials by
            contacting the team.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            8. Your Choices
          </h2>
          <ul className="list-disc space-y-2 pl-6 leading-7">
            <li>
              Disconnect Amazon accounts from the settings workflow when
              supported.
            </li>
            <li>
              Delete drafts, brand guides, or uploaded materials from the
              workspace.
            </li>
            <li>
              Contact Sellavant to request export or deletion of account-related
              information.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            9. Contact
          </h2>
          <p className="leading-7">
            For privacy questions, access requests, or deletion requests, email{' '}
            <a
              href="mailto:privacy@sellavant.com"
              className="text-primary hover:underline"
            >
              privacy@sellavant.com
            </a>
            . For general product inquiries, visit the{' '}
            <Link href="/contact" className="text-primary hover:underline">
              contact page
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
