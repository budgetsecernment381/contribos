import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, FileCode, Brain, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { DiffViewer } from "@/components/shared/diff-viewer";
import { AppShell } from "@/components/layout/app-shell";
import { apiClient } from "@/lib/api";

interface ReviewState {
  id: string;
  jobId: string;
  screen1State: string;
  comprehensionScore: number | null;
  oneLiner: string | null;
  retryCount: number;
  approvalTimestamp: string | null;
}

interface QuestionOption {
  key: string;
  text: string;
}

interface Question {
  id: string;
  type: "mcq" | "yesno" | "freetext";
  question: string;
  options?: QuestionOption[];
  correctKey?: string;
  correctAnswer?: boolean;
}

interface Screen1Content {
  sectionA: string | null;
  sectionB: string | null;
  diffKey: string | null;
  questions: Question[];
  state: string;
  unlockedSections: string[];
}

export function ReviewGate() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<"review" | "comprehension" | "submit">("review");
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [oneLiner, setOneLiner] = useState("");
  const [prTitle, setPrTitle] = useState("");
  const [prDescription, setPrDescription] = useState("");
  const [prType, setPrType] = useState<"draft" | "ready_for_review">("ready_for_review");

  const { data: review, isLoading: reviewLoading } = useQuery({
    queryKey: ["review", reviewId],
    queryFn: () => apiClient.get<ReviewState>(`/reviews/${reviewId}`),
    enabled: !!reviewId,
    refetchInterval: 8000,
  });

  const { data: screen1, isLoading: contentLoading } = useQuery({
    queryKey: ["review-screen1", reviewId],
    queryFn: () => apiClient.get<Screen1Content>(`/reviews/${reviewId}/screen1`),
    enabled: !!reviewId,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (review?.screen1State === "completed") {
      setPhase("submit");
    }
  }, [review?.screen1State]);

  const comprehensionMutation = useMutation({
    mutationFn: (data: { answers: Record<string, unknown>; oneLiner: string }) =>
      apiClient.post<{ passed: boolean; score: number; retryAvailable: boolean; feedback: string }>(
        `/reviews/${reviewId}/comprehension`,
        data
      ),
    onSuccess: (result) => {
      if (result.passed) {
        toast.success(`Comprehension passed with ${result.score}%! You can now approve.`);
        setPhase("submit");
      } else if (result.retryAvailable) {
        toast.error(result.feedback);
      } else {
        toast.error(result.feedback);
        navigate("/dashboard");
      }
      queryClient.invalidateQueries({ queryKey: ["review", reviewId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: () => apiClient.post(`/reviews/${reviewId}/approve`, { prType }),
    onSuccess: () => {
      toast.success("Review approved!");
      navigate("/dashboard");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: () => apiClient.post(`/reviews/${reviewId}/reject`, {}),
    onSuccess: () => {
      toast.success("Fix rejected.");
      navigate("/dashboard");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleSubmitComprehension() {
    if (!oneLiner.trim() || oneLiner.trim().length < 5) {
      toast.error("One-line summary must be at least 5 characters.");
      return;
    }
    const problems: string[] = [];
    for (const q of screen1?.questions ?? []) {
      const a = answers[q.id];
      if (a === undefined || a === "") {
        problems.push(`Q${(screen1?.questions ?? []).indexOf(q) + 1}: Please select or type an answer.`);
      } else if (q.type === "freetext" && typeof a === "string" && a.trim().length < 10) {
        problems.push(`Q${(screen1?.questions ?? []).indexOf(q) + 1}: Freetext answer must be at least 10 characters (currently ${a.trim().length}).`);
      }
    }
    if (problems.length > 0) {
      toast.error(problems[0]);
      return;
    }
    comprehensionMutation.mutate({ answers, oneLiner });
  }

  if (reviewLoading || contentLoading) {
    return (
      <AppShell>
        <div className="space-y-4">
          <div className="h-10 w-48 animate-pulse rounded bg-muted" />
          <div className="h-64 animate-pulse rounded-lg bg-muted" />
          <div className="h-48 animate-pulse rounded-lg bg-muted" />
        </div>
      </AppShell>
    );
  }

  if (!review || !screen1) {
    return (
      <AppShell>
        <div className="rounded-lg border p-6 text-center">
          <p className="text-muted-foreground">Review not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/dashboard")}>
            Back to Dashboard
          </Button>
        </div>
      </AppShell>
    );
  }

  const questions = screen1.questions ?? [];

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            {(["review", "comprehension", "submit"] as const).map((step, idx) => {
              const currentIdx = ["review", "comprehension", "submit"].indexOf(phase);
              const isCompleted = idx < currentIdx;
              const isCurrent = phase === step;
              const isClickable = isCompleted;

              return (
                <div key={step} className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={!isClickable}
                    onClick={() => isClickable && setPhase(step)}
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                      isCurrent
                        ? "bg-primary text-primary-foreground"
                        : isCompleted
                          ? "bg-green-500 text-white cursor-pointer hover:bg-green-600"
                          : "bg-muted text-muted-foreground"
                    } ${!isClickable ? "cursor-default" : ""}`}
                  >
                    {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
                  </button>
                  <span
                    className={`hidden text-xs sm:inline ${isClickable ? "cursor-pointer hover:underline" : ""}`}
                    onClick={() => isClickable && setPhase(step)}
                  >
                    {step === "review" ? "Review" : step === "comprehension" ? "Comprehension" : "Approve"}
                  </span>
                  {idx < 2 && <span className="mx-1 text-muted-foreground">—</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Phase 1: Review the diff and summary */}
        {phase === "review" && (
          <>
            {/* Summary Card */}
            {screen1.sectionA && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Brain className="h-4 w-4" />
                    AI Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap">{screen1.sectionA}</p>
                </CardContent>
              </Card>
            )}

            {/* Execution Trace */}
            {screen1.sectionB && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Execution Trace</CardTitle>
                  <CardDescription>How the agent arrived at this fix</CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="rounded-md bg-muted p-3 text-xs whitespace-pre-wrap max-h-40 overflow-auto font-mono">
                    {screen1.sectionB}
                  </pre>
                </CardContent>
              </Card>
            )}

            {/* Diff */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileCode className="h-4 w-4" />
                  Code Changes
                </CardTitle>
                <CardDescription>Review the generated diff carefully before proceeding</CardDescription>
              </CardHeader>
              <CardContent>
                {screen1.diffKey ? (
                  <div className="max-h-[600px] overflow-auto rounded-lg border">
                    <DiffViewer diff={screen1.diffKey} />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No diff available.</p>
                )}
              </CardContent>
            </Card>

            <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-4">
              <p className="text-sm text-muted-foreground">
                Reviewed the diff? Proceed to answer comprehension questions.
              </p>
              <div className="flex items-center gap-3">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => rejectMutation.mutate()}
                  disabled={rejectMutation.isPending}
                >
                  <XCircle className="mr-1.5 h-4 w-4" />
                  Reject
                </Button>
                <Button onClick={() => setPhase("comprehension")}>
                  Continue to Questions
                  <ArrowLeft className="ml-1.5 h-4 w-4 rotate-180" />
                </Button>
              </div>
            </div>
          </>
        )}

        {/* Phase 2: Comprehension */}
        {phase === "comprehension" && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5" />
                  Comprehension Check
                </CardTitle>
                <CardDescription>
                  Answer these questions about the fix to confirm you understand the changes.
                  You need 70% to pass. One retry is allowed.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* One-liner summary */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    One-line summary of the fix <span className="text-destructive">*</span>
                  </label>
                  <Input
                    placeholder="e.g. Converts value imports to type imports across adapter packages"
                    value={oneLiner}
                    onChange={(e) => setOneLiner(e.target.value)}
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">This will appear in the PR description.</p>
                    <span className={`text-xs ${oneLiner.trim().length < 5 ? "text-destructive" : "text-muted-foreground"}`}>
                      {oneLiner.trim().length}/5 min
                    </span>
                  </div>
                </div>

                <hr />

                {/* Questions */}
                {questions.map((q, idx) => (
                  <div key={q.id} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        Q{idx + 1}
                      </Badge>
                      <span className="text-sm font-medium">{q.question}</span>
                    </div>

                    {q.type === "mcq" && q.options ? (
                      <div className="ml-8 space-y-1.5">
                        {q.options.map((opt) => (
                          <label
                            key={opt.key}
                            className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                              answers[q.id] === opt.key
                                ? "border-primary bg-primary/5"
                                : "hover:bg-accent/50"
                            }`}
                          >
                            <input
                              type="radio"
                              name={q.id}
                              value={opt.key}
                              checked={answers[q.id] === opt.key}
                              onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: opt.key }))}
                              className="h-4 w-4 accent-primary"
                            />
                            <span className="font-mono text-xs text-muted-foreground mr-1">{opt.key}.</span>
                            {opt.text}
                          </label>
                        ))}
                      </div>
                    ) : q.type === "yesno" ? (
                      <div className="ml-8 flex gap-2">
                        {[
                          { val: true, label: "Yes" },
                          { val: false, label: "No" },
                        ].map(({ val, label }) => (
                          <Button
                            key={label}
                            type="button"
                            size="sm"
                            variant={answers[q.id] === val ? "default" : "outline"}
                            onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: val }))}
                          >
                            {label}
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <div className="ml-8 space-y-1">
                        <Textarea
                          placeholder="Your answer (min 10 characters)..."
                          rows={3}
                          value={(answers[q.id] as string) ?? ""}
                          onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                        />
                        <span className={`text-xs ${((answers[q.id] as string) ?? "").trim().length < 10 ? "text-destructive" : "text-muted-foreground"}`}>
                          {((answers[q.id] as string) ?? "").trim().length}/10 min
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-4">
              <Button variant="outline" size="sm" onClick={() => setPhase("review")}>
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                Back to Diff
              </Button>
              <Button
                onClick={handleSubmitComprehension}
                disabled={comprehensionMutation.isPending}
              >
                {comprehensionMutation.isPending ? "Checking..." : "Submit & Continue"}
                <ArrowLeft className="ml-1.5 h-4 w-4 rotate-180" />
              </Button>
            </div>
          </>
        )}

        {/* Phase 3: Approve & Submit */}
        {phase === "submit" && (
          <>
            <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <p className="text-sm font-medium text-green-700">
                  Comprehension check passed! Review the PR details and approve.
                </p>
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Send className="h-5 w-5" />
                  PR Details
                </CardTitle>
                <CardDescription>
                  These details will be used when creating the pull request on GitHub.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">PR Type</label>
                  <div className="flex gap-3">
                    <label
                      className={`flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2.5 text-sm transition-colors ${
                        prType === "ready_for_review"
                          ? "border-primary bg-primary/5 font-medium"
                          : "hover:bg-accent/50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="prType"
                        value="ready_for_review"
                        checked={prType === "ready_for_review"}
                        onChange={() => setPrType("ready_for_review")}
                        className="h-4 w-4 accent-primary"
                      />
                      Ready for Review
                    </label>
                    <label
                      className={`flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2.5 text-sm transition-colors ${
                        prType === "draft"
                          ? "border-primary bg-primary/5 font-medium"
                          : "hover:bg-accent/50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="prType"
                        value="draft"
                        checked={prType === "draft"}
                        onChange={() => setPrType("draft")}
                        className="h-4 w-4 accent-primary"
                      />
                      Draft
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {prType === "draft"
                      ? "PR will be created as a draft — maintainers won't be notified for review."
                      : "PR will be opened and ready for maintainer review immediately."}
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">PR Title</label>
                  <Input
                    placeholder="fix: resolve VK provider authentication issue"
                    value={prTitle}
                    onChange={(e) => setPrTitle(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">PR Description</label>
                  <Textarea
                    placeholder="Describe the changes and their rationale..."
                    rows={4}
                    value={prDescription}
                    onChange={(e) => setPrDescription(e.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    onClick={() => approveMutation.mutate()}
                    disabled={approveMutation.isPending}
                  >
                    {approveMutation.isPending ? "Approving..." : "Approve & Create PR"}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => rejectMutation.mutate()}
                    disabled={rejectMutation.isPending}
                  >
                    Reject Fix
                  </Button>
                  <Button variant="outline" onClick={() => setPhase("comprehension")}>
                    Back
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
