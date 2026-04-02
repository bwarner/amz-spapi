import type { Metadata } from 'next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Mail, MessageSquare } from "lucide-react"

export const metadata: Metadata = {
  title: 'Contact Us — Sellavant',
  description: 'Get in touch with the Sellavant team for support and inquiries.',
}

export default function ContactPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Contact Us</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Have a question, feedback, or need help? We&apos;d love to hear from you.
      </p>

      <div className="mt-12 grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <Mail className="h-8 w-8 text-primary" />
            <CardTitle className="mt-2">Email Support</CardTitle>
            <CardDescription>
              For general questions and account help
            </CardDescription>
          </CardHeader>
          <CardContent>
            <a
              href="mailto:support@sellavant.com"
              className="text-primary font-medium hover:underline"
            >
              support@sellavant.com
            </a>
            <p className="mt-2 text-sm text-muted-foreground">
              We typically respond within 24 hours.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <MessageSquare className="h-8 w-8 text-primary" />
            <CardTitle className="mt-2">Feature Requests</CardTitle>
            <CardDescription>
              Suggest new features or improvements
            </CardDescription>
          </CardHeader>
          <CardContent>
            <a
              href="mailto:feedback@sellavant.com"
              className="text-primary font-medium hover:underline"
            >
              feedback@sellavant.com
            </a>
            <p className="mt-2 text-sm text-muted-foreground">
              We read every message and prioritize based on seller feedback.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-12 rounded-lg border bg-muted/30 p-6">
        <h2 className="text-lg font-semibold text-foreground">Privacy &amp; Security Concerns</h2>
        <p className="mt-2 text-muted-foreground">
          For privacy-related inquiries or to request data deletion, please email{' '}
          <a href="mailto:privacy@sellavant.com" className="text-primary hover:underline">
            privacy@sellavant.com
          </a>.
          See our{' '}
          <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a> for
          details on how we handle your data.
        </p>
      </div>
    </div>
  )
}
