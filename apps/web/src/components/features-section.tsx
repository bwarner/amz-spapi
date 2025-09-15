import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { MessageSquare, TrendingUp, Mail, BarChart3 } from "lucide-react"

const features = [
  {
    icon: MessageSquare,
    title: "Conversational Console",
    description:
      "Chat with your Amazon data using natural language. Ask questions and get instant insights about your business performance.",
  },
  {
    icon: TrendingUp,
    title: "Campaign Optimization",
    description:
      "AI-powered recommendations to optimize your advertising campaigns and maximize ROI across all Amazon ad types.",
  },
  {
    icon: Mail,
    title: "Email Triage",
    description:
      "Automatically categorize and prioritize customer emails. Generate smart responses and manage communications efficiently.",
  },
  {
    icon: BarChart3,
    title: "Profit Analytics",
    description:
      "Deep dive into your profit margins with comprehensive analytics. Track performance across products, campaigns, and time periods.",
  },
]

export function FeaturesSection() {
  return (
    <section id="features" className="py-20 sm:py-32">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl text-balance">
            Everything you need to scale your Amazon business
          </h2>
          <p className="mt-4 text-lg text-muted-foreground text-pretty">
            Our AI-powered platform provides all the tools you need to optimize operations and maximize profits.
          </p>
        </div>

        <div className="mx-auto mt-16 grid max-w-5xl grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-2">
          {features.map((feature, index) => (
            <Card key={index} className="relative overflow-hidden border-border/50 bg-card/50 backdrop-blur">
              <CardHeader>
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-xl font-semibold text-card-foreground">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base text-muted-foreground">{feature.description}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
