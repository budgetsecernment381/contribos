import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { StepWizard } from "@/components/shared/step-wizard";
import { TierBadge } from "@/components/shared/tier-badge";
import { EcosystemPicker } from "@/components/shared/ecosystem-picker";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { apiClient } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

const STEPS = [
  { id: "signal", label: "GitHub Signal", description: "Ingest your profile" },
  { id: "preferences", label: "Preferences", description: "Ecosystem & goals" },
  { id: "calibration", label: "Calibration", description: "Skill assessment" },
  { id: "result", label: "Tier", description: "Your placement" },
];

const ecosystemSchema = z.object({
  ecosystems: z.array(z.string()).min(1, "Select at least one ecosystem"),
  goal: z.string().min(1),
  timeBudget: z.string().min(1),
});

const calibrationSchema = z.object({
  familiarityLevel: z.enum(["never", "occasional", "regular", "contributed"]),
  fixIntent: z.enum(["minimal_safe", "correct_complete", "full_understanding"]),
  openEndedResponse: z.string().optional(),
});

export function OnboardingFlow() {
  const navigate = useNavigate();
  const [stage, setStage] = useState(0);
  const [tierResult, setTierResult] = useState<{ tier: 1 | 2 | 3 | 4; rationale?: string } | null>(null);

  const ecosystemForm = useForm<z.infer<typeof ecosystemSchema>>({
    resolver: zodResolver(ecosystemSchema),
    defaultValues: { ecosystems: [], goal: "", timeBudget: "" },
  });

  const calibrationForm = useForm<z.infer<typeof calibrationSchema>>({
    resolver: zodResolver(calibrationSchema),
    defaultValues: { familiarityLevel: undefined, fixIntent: undefined, openEndedResponse: "" },
  });

  const completeMutation = useMutation({
    mutationFn: () => apiClient.post("/onboarding/goals", {
      goal: ecosystemForm.getValues().goal || "explore",
      timeBudget: ecosystemForm.getValues().timeBudget || "standard",
      ecosystems: ecosystemForm.getValues().ecosystems,
    }),
    onSuccess: () => {
      useAuthStore.getState().setUser({
        ...useAuthStore.getState().user!,
        onboardingComplete: true,
      });
      navigate("/dashboard");
    },
  });

  const handleStage1Next = () => {
    setStage(1);
  };

  const handleStage2Next = ecosystemForm.handleSubmit(() => {
    setStage(2);
  });

  const handleStage3Next = calibrationForm.handleSubmit(async () => {
    const cal = calibrationForm.getValues();
    const res = await apiClient
      .post<{ tier: 1 | 2 | 3 | 4; rationale?: string }>("/onboarding/calibration", {
        familiarityLevel: cal.familiarityLevel,
        fixIntent: cal.fixIntent,
        openEndedResponse: cal.openEndedResponse,
      })
      .catch(() => ({ tier: 2 as const, rationale: "Default placement" }));
    setTierResult(res);
    setStage(3);
  });

  const handleComplete = () => {
    completeMutation.mutate();
  };

  const selectedEcosystems = ecosystemForm.watch("ecosystems");

  return (
    <div className="mx-auto max-w-2xl py-8">
      <StepWizard steps={STEPS} currentStep={stage} className="mb-8" />

      {stage === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>GitHub Signal Ingestion</CardTitle>
            <CardDescription>
              We're analyzing your GitHub profile to understand your experience
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={60} className="h-2" />
            <p className="text-sm text-muted-foreground">
              Fetching repos, contributions, and activity...
            </p>
            <Button onClick={handleStage1Next}>Continue</Button>
          </CardContent>
        </Card>
      )}

      {stage === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Preferences</CardTitle>
            <CardDescription>
              Tell us about your tech stack, goals, and availability
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...ecosystemForm}>
              <form onSubmit={handleStage2Next} className="space-y-6">
                <FormField
                  control={ecosystemForm.control}
                  name="ecosystems"
                  render={() => (
                    <FormItem>
                      <FormLabel>
                        Tech Stack / Languages
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          (select all that apply, or type your own)
                        </span>
                      </FormLabel>
                      <FormControl>
                        <EcosystemPicker
                          selected={selectedEcosystems}
                          onChange={(ecosystems) =>
                            ecosystemForm.setValue("ecosystems", ecosystems, { shouldValidate: true })
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={ecosystemForm.control}
                  name="goal"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Goal</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select goal" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="explore">Explore open source</SelectItem>
                          <SelectItem value="ecosystem_depth">Deepen ecosystem skills</SelectItem>
                          <SelectItem value="give_back">Give back to projects</SelectItem>
                          <SelectItem value="job_hunt">Build portfolio for jobs</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={ecosystemForm.control}
                  name="timeBudget"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Time Budget</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select time budget" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="quick">1-3 hrs/week</SelectItem>
                          <SelectItem value="standard">3-8 hrs/week</SelectItem>
                          <SelectItem value="deep">8+ hrs/week</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={selectedEcosystems.length === 0}>
                  Continue
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      )}

      {stage === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Calibration</CardTitle>
            <CardDescription>
              Help us understand your familiarity and intent
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...calibrationForm}>
              <form onSubmit={handleStage3Next} className="space-y-4">
                <FormField
                  control={calibrationForm.control}
                  name="familiarityLevel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Familiarity with codebase</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="never">Never contributed</SelectItem>
                          <SelectItem value="occasional">Occasional contributor</SelectItem>
                          <SelectItem value="regular">Regular contributor</SelectItem>
                          <SelectItem value="contributed">Active maintainer</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={calibrationForm.control}
                  name="fixIntent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fix intent</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select approach" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="minimal_safe">Minimal safe fix</SelectItem>
                          <SelectItem value="correct_complete">Correct and complete</SelectItem>
                          <SelectItem value="full_understanding">Full understanding refactor</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={calibrationForm.control}
                  name="openEndedResponse"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Additional context (optional)</FormLabel>
                      <Textarea placeholder="Any other context..." {...field} />
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit">Get Tier</Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      )}

      {stage === 3 && tierResult && (
        <Card>
          <CardHeader>
            <CardTitle>Your Tier</CardTitle>
            <CardDescription>
              Based on your profile and calibration
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <TierBadge tier={tierResult.tier} />
            </div>
            {tierResult.rationale && (
              <p className="text-sm text-muted-foreground">
                {tierResult.rationale}
              </p>
            )}
            <Button
              onClick={handleComplete}
              disabled={completeMutation.isPending}
            >
              {completeMutation.isPending ? "Completing..." : "Complete Onboarding"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
