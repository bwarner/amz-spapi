import { Button } from "@/components/ui/button"
import { ArrowRight, Play } from "lucide-react"

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-background to-muted/20 py-20 sm:py-32">
      <div className="container relative">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl text-balance">
            AI assistant for <span className="text-primary">Amazon Operations</span>
          </h1>
          <p className="mt-6 text-lg leading-8 text-muted-foreground text-pretty max-w-2xl mx-auto">
            Streamline your Amazon selling operations with our AI-powered platform. Optimize campaigns, manage emails,
            analyze profits, and chat with your data—all in one place.
          </p>
          <div className="mt-10 flex items-center justify-center gap-x-6">
            <Button size="lg" className="bg-secondary text-secondary-foreground hover:bg-secondary/90">
              Start Free Trial
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button variant="outline" size="lg" className="group bg-transparent">
              <Play className="mr-2 h-4 w-4 group-hover:scale-110 transition-transform" />
              Watch Demo
            </Button>
          </div>
          <div className="mt-16 flow-root sm:mt-24">
            <div className="relative rounded-xl bg-card/50 p-2 ring-1 ring-border backdrop-blur">
              <img
                src="/modern-dashboard-interface-with-charts-and-analyti.jpg"
                alt="Amazon Seller Assistant Dashboard"
                className="rounded-lg shadow-2xl ring-1 ring-border"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
