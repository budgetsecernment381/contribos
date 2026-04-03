import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface Step {
  id: string;
  label: string;
  description?: string;
}

interface StepWizardProps {
  steps: Step[];
  currentStep: number;
  className?: string;
}

export function StepWizard({ steps, currentStep, className }: StepWizardProps) {
  return (
    <nav aria-label="Progress" className={cn("w-full", className)}>
      <ol className="flex items-center">
        {steps.map((step, index) => {
          const isComplete = index < currentStep;
          const isCurrent = index === currentStep;
          const isLast = index === steps.length - 1;

          return (
            <li
              key={step.id}
              className={cn(
                "relative flex flex-1",
                !isLast && "pr-8 sm:pr-20"
              )}
            >
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                    isComplete &&
                      "border-primary bg-primary text-primary-foreground",
                    isCurrent && "border-primary bg-background",
                    !isComplete &&
                      !isCurrent &&
                      "border-muted-foreground/30 bg-background"
                  )}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  {isComplete ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <span className="text-sm font-medium">{index + 1}</span>
                  )}
                </div>
                <span
                  className={cn(
                    "mt-2 text-center text-xs font-medium sm:text-sm",
                    isCurrent ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {step.label}
                </span>
                {step.description && (
                  <span className="mt-0.5 hidden text-xs text-muted-foreground sm:block">
                    {step.description}
                  </span>
                )}
              </div>
              {!isLast && (
                <div
                  className="absolute left-1/2 top-5 -ml-px h-0.5 w-full -translate-y-1/2 sm:top-5"
                  aria-hidden="true"
                >
                  <div
                    className={cn(
                      "h-full w-full",
                      isComplete ? "bg-primary" : "bg-muted"
                    )}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
