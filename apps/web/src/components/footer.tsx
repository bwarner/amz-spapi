import Image from 'next/image';
import Link from 'next/link';

const legalLinks = [
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/terms', label: 'Terms of Service' },
];

const companyLinks = [
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
];

const productLinks = [
  { href: '/#product', label: 'Product' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/#workflow', label: 'Workflow' },
  { href: '/login', label: 'Sign In' },
];

export function Footer() {
  return (
    <footer className="border-t bg-muted/20">
      <div className="container mx-auto px-4 py-12 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))]">
          <div className="space-y-4">
            <Image
              src="/brand/sellavant-logo-horizontal.svg"
              alt="Sellavant"
              width={148}
              height={32}
              loading="lazy"
            />
            <p className="max-w-sm text-sm leading-6 text-muted-foreground">
              Sellavant helps Amazon teams organize product sources, shape brand
              guides, and produce cleaner A+ content workflows with AI.
            </p>
            <p className="text-sm text-muted-foreground">
              Sellavant is operated by Farvision LLC.
            </p>
            <p className="text-sm text-muted-foreground">
              Contact:{' '}
              <a
                href="mailto:support@sellavant.com"
                className="text-foreground hover:text-primary"
              >
                support@sellavant.com
              </a>
            </p>
          </div>

          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Product</h2>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {productLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Company</h2>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {companyLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Legal</h2>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {legalLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t pt-6 text-sm text-muted-foreground">
          <p>
            © {new Date().getFullYear()} Farvision LLC. Sellavant workflows for
            Amazon are powered by seller-authorized integrations and
            customer-provided assets.
          </p>
        </div>
      </div>
    </footer>
  );
}
