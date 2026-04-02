import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { UserPlus, Settings, Rocket } from "lucide-react"

const steps = [
  {
    icon: UserPlus,
    step: "01",
    title: "Create Your Account",
    description: "Sign up in seconds and connect your Amazon Seller Central account securely.",
  },
  {
    icon: Settings,
    step: "02",
    title: "Configure Settings",
    description: "Set up your preferences, connect your advertising accounts, and customize your dashboard.",
  },
  {
    icon: Rocket,
    step: "03",
    title: "Start Optimizing",
    description: "Begin using AI-powered insights to optimize campaigns, manage emails, and track profits.",
  },
]

export function GettingStartedSection() {
  return (
    <section id="getting-started" className="bg-muted/30 py-20 sm:py-32">
      <div className="container px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl text-balance">
            Get started in minutes
          </h2>
          <p className="mt-4 text-lg text-muted-foreground text-pretty">
            Our streamlined onboarding process gets you up and running quickly.
          </p>
        </div>

        <div className="mx-auto mt-16 grid max-w-4xl grid-cols-1 gap-8 sm:grid-cols-3">
          {steps.map((step, index) => (
            <Card key={index} className="relative text-center border-border/50 bg-background/80 backdrop-blur">
              <CardHeader className="pb-4">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                  <step.icon className="h-8 w-8 text-primary" />
                </div>
                <div className="absolute -top-3 left-4 flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground">
                  {step.step}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <CardTitle className="text-lg font-semibold text-card-foreground mb-2">{step.title}</CardTitle>
                <CardDescription className="text-sm text-muted-foreground">{step.description}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
