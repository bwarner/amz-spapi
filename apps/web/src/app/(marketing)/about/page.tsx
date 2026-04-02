import type { Metadata } from 'next'
import { Card, CardContent } from "@/components/ui/card"
import { MessageSquare, TrendingUp, Shield } from "lucide-react"

export const metadata: Metadata = {
  title: 'About — Sellavant',
  description: 'Learn about Sellavant, the AI-powered assistant for Amazon sellers.',
}

export default function AboutPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold tracking-tight">About Sellavant</h1>

      <div className="mt-8 space-y-6 text-muted-foreground leading-relaxed">
        <p className="text-lg">
          Sellavant is an AI-powered operations platform built for Amazon sellers who want to
          spend less time digging through data and more time growing their business.
        </p>

        <p>
          We combine the power of Amazon&apos;s official APIs with modern AI to give you a
          conversational interface to your entire Amazon business. Ask questions in plain English,
          get instant answers backed by real data, and receive actionable recommendations to
          improve your listings, optimize your ads, and increase your margins.
        </p>
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-3">
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 text-center">
            <MessageSquare className="mx-auto h-8 w-8 text-primary" />
            <h3 className="mt-3 font-semibold text-foreground">Ask Anything</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Chat with your Amazon data using natural language
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 text-center">
            <TrendingUp className="mx-auto h-8 w-8 text-primary" />
            <h3 className="mt-3 font-semibold text-foreground">Optimize Listings</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              AI-powered critique and improvement suggestions
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 text-center">
            <Shield className="mx-auto h-8 w-8 text-primary" />
            <h3 className="mt-3 font-semibold text-foreground">Secure by Design</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Official Amazon APIs, encrypted storage, full compliance
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-12 space-y-6 text-muted-foreground leading-relaxed">
        <h2 className="text-xl font-semibold text-foreground">Our Mission</h2>
        <p>
          Amazon selling is complex. Between managing listings, tracking orders, optimizing ads,
          monitoring inventory, and analyzing margins, sellers are drowning in dashboards and
          spreadsheets. We believe there&apos;s a better way.
        </p>
        <p>
          Sellavant brings all your Amazon data into one conversational interface. Instead of
          clicking through Seller Central, you can simply ask: &quot;How are my tea infuser listings
          performing?&quot; or &quot;What can I do to improve my conversion rate?&quot; — and get actionable
          answers in seconds.
        </p>

        <h2 className="text-xl font-semibold text-foreground">Built for Sellers</h2>
        <p>
          Sellavant is built by a team with deep experience in e-commerce, cloud infrastructure,
          and AI. We understand the challenges Amazon sellers face because we&apos;ve been in the
          trenches ourselves. Every feature we build starts with one question: does this help
          a seller make better decisions faster?
        </p>
      </div>
    </div>
  )
}
