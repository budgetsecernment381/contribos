import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  UserPlus,
  Search,
  FileCheck,
  Send,
  Shield,
  Bot,
} from "lucide-react";

const steps = [
  {
    icon: UserPlus,
    title: "Onboard",
    description: "Connect GitHub and complete calibration to get your tier",
  },
  {
    icon: Search,
    title: "Match",
    description: "AI finds issues that fit your skills and goals",
  },
  {
    icon: FileCheck,
    title: "Review",
    description: "Human reviewers validate every contribution",
  },
  {
    icon: Send,
    title: "Submit",
    description: "Open PRs on real open-source repositories",
  },
];

export function LandingPage() {
  const { login } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container flex h-16 items-center justify-between">
          <span className="font-mono text-xl font-bold text-primary">
            ContribOS
          </span>
          <Button variant="outline" onClick={login}>
            Sign in
          </Button>
        </div>
      </header>

      <main>
        <section className="container py-24 md:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="font-mono text-4xl font-bold tracking-tight md:text-5xl lg:text-6xl">
              Build your open-source reputation
            </h1>
            <p className="mt-6 text-lg text-muted-foreground md:text-xl">
              Smart tools, human-reviewed contributions. Every PR is vetted by
              real maintainers before merge.
            </p>
            <Button
              size="lg"
              className="mt-8 h-12 px-8 text-base"
              onClick={login}
            >
              Sign in with GitHub
            </Button>
          </div>
        </section>

        <section className="border-t bg-muted/30 py-24">
          <div className="container">
            <h2 className="font-mono text-center text-2xl font-bold md:text-3xl">
              How it works
            </h2>
            <div className="mx-auto mt-16 grid max-w-4xl gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((step, i) => (
                <div
                  key={step.title}
                  className="flex flex-col items-center rounded-lg border bg-card p-6 text-center shadow-sm"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <step.icon className="h-6 w-6" />
                  </div>
                  <span className="mt-4 font-mono text-sm font-semibold">
                    Step {i + 1}: {step.title}
                  </span>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="container py-24">
          <div className="mx-auto flex max-w-2xl flex-col gap-8 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Shield className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-mono font-semibold">
                  Every contribution is human-reviewed
                </h3>
                <p className="text-sm text-muted-foreground">
                  No AI-only merges. Maintainers approve every change.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Bot className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-mono font-semibold">
                  Quality guaranteed
                </h3>
                <p className="text-sm text-muted-foreground">
                  Every contribution passes quality gates and human review.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-8">
        <div className="container text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} ContribOS. Build your open-source reputation.
        </div>
      </footer>
    </div>
  );
}
