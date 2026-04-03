import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeBlock } from "@/components/shared/code-block";
import { AppShell } from "@/components/layout/app-shell";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";

const HOLDING_REPLY = `Thanks for the feedback. I'm currently looking into this and will respond shortly.`;

interface InboxDetail {
  id: string;
  commentType: string;
  paraphrase: string;
  suggestedApproach: string;
  codeNavHint: string | null;
  toneGuidance: string | null;
  holdingReplyTemplate: string | null;
  isAcknowledged: boolean;
}

export function InboxDetail() {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: item, isLoading } = useQuery({
    queryKey: ["inbox", itemId],
    queryFn: () => apiClient.get<InboxDetail>(`/inbox/${itemId}`),
    enabled: !!itemId,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: () => apiClient.post(`/inbox/${itemId}/acknowledge`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
      toast.success("Acknowledged");
    },
  });

  const copyHoldingReply = () => {
    navigator.clipboard.writeText(item?.holdingReplyTemplate ?? HOLDING_REPLY);
    toast.success("Copied to clipboard");
  };

  if (isLoading || !item) {
    return (
      <AppShell>
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>{item.paraphrase}</CardTitle>
            <CardDescription>{item.commentType}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h4 className="font-mono text-sm font-semibold">Suggested Approach</h4>
              <p className="mt-2 whitespace-pre-wrap text-sm">{item.suggestedApproach}</p>
            </div>

            {(item.codeNavHint || item.toneGuidance) && (
              <div>
                <h4 className="font-mono text-sm font-semibold">Guidance</h4>
                <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
                  {item.codeNavHint && <li>Code: {item.codeNavHint}</li>}
                  {item.toneGuidance && <li>Tone: {item.toneGuidance}</li>}
                </ul>
              </div>
            )}

            <div>
              <h4 className="font-mono text-sm font-semibold">Holding reply template</h4>
              <div className="mt-2">
                <CodeBlock
                  code={item.holdingReplyTemplate ?? HOLDING_REPLY}
                  className="mt-2"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={copyHoldingReply}
                >
                  Copy template
                </Button>
              </div>
            </div>

            <Button
              onClick={() => acknowledgeMutation.mutate()}
              disabled={acknowledgeMutation.isPending}
            >
              {acknowledgeMutation.isPending ? "Acknowledging..." : "Acknowledge"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
