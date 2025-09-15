import { Button } from "@/components/ui/button"
import { ArrowRight, CheckCircle } from "lucide-react"

const benefits = ["Free 14-day trial", "No credit card required", "Cancel anytime", "24/7 support included"]

export function CTASection() {
  return (
    <section className="py-20 sm:py-32">
      <div className="container">
        <div className="mx-auto max-w-4xl">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-primary to-primary/80 px-8 py-16 shadow-2xl sm:px-16">
            <div className="relative mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-primary-foreground sm:text-4xl text-balance">
                Ready to transform your Amazon business?
              </h2>
              <p className="mt-4 text-lg text-primary-foreground/90 text-pretty">
                Join thousands of sellers who are already using AI to optimize their operations and increase profits.
              </p>

              <div className="mt-8 flex flex-wrap justify-center gap-4 text-sm text-primary-foreground/90">
                {benefits.map((benefit, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-secondary" />
                    <span>{benefit}</span>
                  </div>
                ))}
              </div>

              <div className="mt-10">
                <Button
                  size="lg"
                  variant="secondary"
                  className="bg-secondary text-secondary-foreground hover:bg-secondary/90"
                >
                  Start Your Free Trial
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
