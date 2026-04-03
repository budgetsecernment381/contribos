import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Zap,
  Star,
  Loader2,
  Check,
  Cpu,
  Bot,
  RefreshCw,
  Search,
} from "lucide-react";

interface CustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  maskedApiKey: string;
  modelId: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface BuiltInProvider {
  id: string;
  name: string;
  source: "built_in";
  models: { id: string; name: string }[];
}

interface AgentProvider {
  id: string;
  name: string;
  agentCardUrl: string;
  endpoint: string;
  maskedApiKey: string | null;
  authScheme: string;
  cachedSkills: Array<{ id: string; name: string; description?: string }> | null;
  cachedCapabilities: Record<string, boolean> | null;
  isDefault: boolean;
  lastDiscoveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DiscoveredAgent {
  name: string;
  description?: string;
  url: string;
  skills: Array<{ id: string; name: string; description?: string }>;
  capabilities?: Record<string, boolean>;
}

interface ProviderFormData {
  name: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

interface AgentFormData {
  agentCardUrl: string;
  name: string;
  apiKey: string;
  authScheme: string;
}

const emptyForm: ProviderFormData = { name: "", baseUrl: "", apiKey: "", modelId: "" };
const emptyAgentForm: AgentFormData = { agentCardUrl: "", name: "", apiKey: "", authScheme: "bearer" };

export function ProviderSettings() {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderFormData>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Agent provider state
  const [agentFormOpen, setAgentFormOpen] = useState(false);
  const [agentEditingId, setAgentEditingId] = useState<string | null>(null);
  const [agentForm, setAgentForm] = useState<AgentFormData>(emptyAgentForm);
  const [agentDeleteTarget, setAgentDeleteTarget] = useState<string | null>(null);
  const [discoveredAgent, setDiscoveredAgent] = useState<DiscoveredAgent | null>(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);

  const { data: customProviders = [], isLoading: loadingCustom } = useQuery({
    queryKey: ["custom-providers"],
    queryFn: () => apiClient.get<CustomProvider[]>("/custom-providers"),
  });

  const { data: catalogData } = useQuery({
    queryKey: ["provider-catalog"],
    queryFn: () =>
      apiClient.get<{
        providers: (BuiltInProvider | (CustomProvider & { source: "custom" }))[];
      }>("/ai/providers"),
    staleTime: 5 * 60 * 1000,
  });

  const builtInProviders = (catalogData?.providers ?? []).filter(
    (p) => "source" in p && p.source === "built_in"
  ) as BuiltInProvider[];

  const createMutation = useMutation({
    mutationFn: (data: ProviderFormData) =>
      apiClient.post<CustomProvider>("/custom-providers", data),
    onSuccess: () => {
      toast.success("Custom provider created");
      queryClient.invalidateQueries({ queryKey: ["custom-providers"] });
      queryClient.invalidateQueries({ queryKey: ["provider-catalog"] });
      closeForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Partial<ProviderFormData>;
    }) => apiClient.patch<CustomProvider>(`/custom-providers/${id}`, data),
    onSuccess: () => {
      toast.success("Provider updated");
      queryClient.invalidateQueries({ queryKey: ["custom-providers"] });
      queryClient.invalidateQueries({ queryKey: ["provider-catalog"] });
      closeForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/custom-providers/${id}`),
    onSuccess: () => {
      toast.success("Provider deleted");
      queryClient.invalidateQueries({ queryKey: ["custom-providers"] });
      queryClient.invalidateQueries({ queryKey: ["provider-catalog"] });
      setDeleteTarget(null);
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post<{ success: boolean; latencyMs?: number; error?: string }>(
        `/custom-providers/${id}/test`
      ),
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`Connection successful (${data.latencyMs}ms)`);
      } else {
        toast.error(`Connection failed: ${data.error}`);
      }
    },
  });

  const defaultMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post(`/custom-providers/${id}/default`),
    onSuccess: () => {
      toast.success("Default provider updated");
      queryClient.invalidateQueries({ queryKey: ["custom-providers"] });
      queryClient.invalidateQueries({ queryKey: ["provider-catalog"] });
    },
  });

  const clearDefaultMutation = useMutation({
    mutationFn: () => apiClient.delete("/custom-providers/default"),
    onSuccess: () => {
      toast.success("Default cleared");
      queryClient.invalidateQueries({ queryKey: ["custom-providers"] });
    },
  });

  // --- Agent Provider Queries & Mutations ---
  const { data: agentProviders = [], isLoading: loadingAgents } = useQuery({
    queryKey: ["agent-providers"],
    queryFn: () => apiClient.get<AgentProvider[]>("/agent-providers"),
  });

  const createAgentMutation = useMutation({
    mutationFn: (data: {
      name: string;
      agentCardUrl: string;
      endpoint: string;
      apiKey?: string;
      authScheme?: string;
      cachedSkills?: unknown;
      cachedCapabilities?: unknown;
    }) => apiClient.post<AgentProvider>("/agent-providers", data),
    onSuccess: () => {
      toast.success("Agent provider created");
      queryClient.invalidateQueries({ queryKey: ["agent-providers"] });
      queryClient.invalidateQueries({ queryKey: ["provider-catalog"] });
      closeAgentForm();
    },
    onError: () => toast.error("Failed to create agent provider"),
  });

  const updateAgentMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<AgentFormData> }) =>
      apiClient.patch<AgentProvider>(`/agent-providers/${id}`, data),
    onSuccess: () => {
      toast.success("Agent provider updated");
      queryClient.invalidateQueries({ queryKey: ["agent-providers"] });
      queryClient.invalidateQueries({ queryKey: ["provider-catalog"] });
      closeAgentForm();
    },
  });

  const deleteAgentMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/agent-providers/${id}`),
    onSuccess: () => {
      toast.success("Agent provider deleted");
      queryClient.invalidateQueries({ queryKey: ["agent-providers"] });
      queryClient.invalidateQueries({ queryKey: ["provider-catalog"] });
      setAgentDeleteTarget(null);
    },
  });

  const testAgentMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post<{ success: boolean; latencyMs: number; error?: string }>(
        `/agent-providers/${id}/test`
      ),
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`Agent connected (${data.latencyMs}ms)`);
      } else {
        toast.error(`Agent connection failed: ${data.error}`);
      }
    },
  });

  const refreshAgentMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post<AgentProvider>(`/agent-providers/${id}/discover`),
    onSuccess: () => {
      toast.success("Agent capabilities refreshed");
      queryClient.invalidateQueries({ queryKey: ["agent-providers"] });
    },
  });

  const agentDefaultMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post(`/agent-providers/${id}/default`),
    onSuccess: () => {
      toast.success("Default agent provider updated");
      queryClient.invalidateQueries({ queryKey: ["agent-providers"] });
      queryClient.invalidateQueries({ queryKey: ["provider-catalog"] });
    },
  });

  const clearAgentDefaultMutation = useMutation({
    mutationFn: () => apiClient.delete("/agent-providers/default"),
    onSuccess: () => {
      toast.success("Agent default cleared");
      queryClient.invalidateQueries({ queryKey: ["agent-providers"] });
    },
  });

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  function openEdit(p: CustomProvider) {
    setEditingId(p.id);
    setForm({ name: p.name, baseUrl: p.baseUrl, apiKey: "", modelId: p.modelId });
    setFormOpen(true);
  }

  function handleSubmit() {
    if (editingId) {
      const data: Partial<ProviderFormData> = {};
      if (form.name) data.name = form.name;
      if (form.baseUrl) data.baseUrl = form.baseUrl;
      if (form.apiKey) data.apiKey = form.apiKey;
      if (form.modelId) data.modelId = form.modelId;
      updateMutation.mutate({ id: editingId, data });
    } else {
      createMutation.mutate(form);
    }
  }

  function closeAgentForm() {
    setAgentFormOpen(false);
    setAgentEditingId(null);
    setAgentForm(emptyAgentForm);
    setDiscoveredAgent(null);
  }

  async function handleDiscoverAgent() {
    if (!agentForm.agentCardUrl) return;
    setDiscoverLoading(true);
    try {
      const card = await apiClient.post<DiscoveredAgent>("/agent-providers/discover", {
        agentCardUrl: agentForm.agentCardUrl,
      });
      setDiscoveredAgent(card);
      if (card.name && !agentForm.name) {
        setAgentForm((f) => ({ ...f, name: card.name }));
      }
      toast.success("Agent discovered");
    } catch {
      toast.error("Failed to discover agent — check the URL");
    } finally {
      setDiscoverLoading(false);
    }
  }

  function handleAgentSubmit() {
    if (agentEditingId) {
      const data: Partial<AgentFormData> = {};
      if (agentForm.name) data.name = agentForm.name;
      if (agentForm.apiKey) data.apiKey = agentForm.apiKey;
      if (agentForm.authScheme) data.authScheme = agentForm.authScheme;
      updateAgentMutation.mutate({ id: agentEditingId, data });
    } else if (discoveredAgent) {
      createAgentMutation.mutate({
        name: agentForm.name || discoveredAgent.name,
        agentCardUrl: agentForm.agentCardUrl,
        endpoint: discoveredAgent.url,
        apiKey: agentForm.apiKey || undefined,
        authScheme: agentForm.authScheme || "bearer",
        cachedSkills: discoveredAgent.skills,
        cachedCapabilities: discoveredAgent.capabilities,
      });
    }
  }

  function openAgentEdit(p: AgentProvider) {
    setAgentEditingId(p.id);
    setAgentForm({
      agentCardUrl: p.agentCardUrl,
      name: p.name,
      apiKey: "",
      authScheme: p.authScheme,
    });
    setAgentFormOpen(true);
  }

  const isPending = createMutation.isPending || updateMutation.isPending;
  const isAgentPending = createAgentMutation.isPending || updateAgentMutation.isPending;

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="font-mono text-2xl font-bold">LLM Providers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage built-in and custom LLM providers for your jobs
          </p>
        </div>

        {/* Built-in Providers */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Built-in Providers</CardTitle>
            <CardDescription>
              Server-configured providers available to all users
            </CardDescription>
          </CardHeader>
          <CardContent>
            {builtInProviders.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No built-in providers are currently configured
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {builtInProviders.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 rounded-lg border p-3"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
                      <Cpu className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.models.map((m) => m.name).join(", ")}
                      </p>
                    </div>
                    <Badge variant="secondary" className="shrink-0 text-xs">
                      Built-in
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Custom Providers */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Custom Providers</CardTitle>
              <CardDescription>
                Add your own OpenAI-compatible endpoints (BYOK)
              </CardDescription>
            </div>
            <Dialog open={formOpen} onOpenChange={(o) => { if (!o) closeForm(); else { setEditingId(null); setForm(emptyForm); setFormOpen(true); } }}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add Provider
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {editingId ? "Edit Provider" : "Add Custom Provider"}
                  </DialogTitle>
                  <DialogDescription>
                    {editingId
                      ? "Update your custom provider settings. Leave API key empty to keep the existing one."
                      : "Enter your OpenAI-compatible endpoint details"}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label htmlFor="cp-name">Name</Label>
                    <Input
                      id="cp-name"
                      placeholder="My Local LLM"
                      value={form.name}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, name: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cp-url">Base URL</Label>
                    <Input
                      id="cp-url"
                      placeholder="https://api.example.com"
                      value={form.baseUrl}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, baseUrl: e.target.value }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Full endpoint URL, used as-is (e.g. https://api.example.com/v1/chat/completions)
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cp-key">API Key</Label>
                    <Input
                      id="cp-key"
                      type="password"
                      placeholder={editingId ? "Leave empty to keep existing" : "sk-..."}
                      value={form.apiKey}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, apiKey: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cp-model">Model ID</Label>
                    <Input
                      id="cp-model"
                      placeholder="gpt-4o, llama-3, etc."
                      value={form.modelId}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, modelId: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogClose>
                  <Button onClick={handleSubmit} disabled={isPending}>
                    {isPending && (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    )}
                    {editingId ? "Save Changes" : "Add Provider"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {loadingCustom ? (
              <div className="h-24 animate-pulse rounded bg-muted" />
            ) : customProviders.length === 0 ? (
              <EmptyState
                icon={<Cpu className="h-6 w-6" />}
                title="No custom providers"
                description="Add your own OpenAI-compatible endpoint to get started"
              />
            ) : (
              <div className="space-y-3">
                {customProviders.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-4 rounded-lg border p-4"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-500/10">
                      <Zap className="h-5 w-5 text-blue-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.name}</span>
                        <Badge variant="outline" className="text-xs">
                          Custom
                        </Badge>
                        {p.isDefault && (
                          <Badge className="text-xs">
                            <Star className="mr-1 h-3 w-3" />
                            Default
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="font-mono">{p.baseUrl}</span>
                        <span>Model: {p.modelId}</span>
                        <span>Key: {p.maskedApiKey}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => testMutation.mutate(p.id)}
                        disabled={testMutation.isPending}
                        title="Test connection"
                      >
                        {testMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      {!p.isDefault ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => defaultMutation.mutate(p.id)}
                          disabled={defaultMutation.isPending}
                          title="Set as default"
                        >
                          <Star className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => clearDefaultMutation.mutate()}
                          disabled={clearDefaultMutation.isPending}
                          title="Clear default"
                        >
                          <Star className="h-3.5 w-3.5 fill-current" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(p)}
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Dialog
                        open={deleteTarget === p.id}
                        onOpenChange={(o) => setDeleteTarget(o ? p.id : null)}
                      >
                        <DialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Delete Provider</DialogTitle>
                            <DialogDescription>
                              Are you sure you want to delete "{p.name}"? This
                              cannot be undone.
                            </DialogDescription>
                          </DialogHeader>
                          <DialogFooter>
                            <DialogClose asChild>
                              <Button variant="outline">Cancel</Button>
                            </DialogClose>
                            <Button
                              variant="destructive"
                              onClick={() => deleteMutation.mutate(p.id)}
                              disabled={deleteMutation.isPending}
                            >
                              {deleteMutation.isPending && (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              )}
                              Delete
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        {/* Agent Providers (A2A) */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Agent Providers (A2A)</CardTitle>
              <CardDescription>
                Connect external A2A agents for task delegation
              </CardDescription>
            </div>
            <Dialog open={agentFormOpen} onOpenChange={(o) => { if (!o) closeAgentForm(); else { setAgentEditingId(null); setAgentForm(emptyAgentForm); setDiscoveredAgent(null); setAgentFormOpen(true); } }}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add Agent
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>
                    {agentEditingId ? "Edit Agent Provider" : "Add A2A Agent"}
                  </DialogTitle>
                  <DialogDescription>
                    {agentEditingId
                      ? "Update your agent provider settings"
                      : "Enter the agent's URL to discover its capabilities"}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  {!agentEditingId && (
                    <div className="space-y-2">
                      <Label htmlFor="agent-url">Agent Card URL</Label>
                      <div className="flex gap-2">
                        <Input
                          id="agent-url"
                          placeholder="https://agent.example.com"
                          value={agentForm.agentCardUrl}
                          onChange={(e) =>
                            setAgentForm((f) => ({ ...f, agentCardUrl: e.target.value }))
                          }
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleDiscoverAgent}
                          disabled={discoverLoading || !agentForm.agentCardUrl}
                        >
                          {discoverLoading ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Search className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          Discover
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        URL to the agent's server. We'll fetch /.well-known/agent.json automatically.
                      </p>
                    </div>
                  )}

                  {discoveredAgent && (
                    <div className="rounded-lg border bg-muted/50 p-3">
                      <p className="text-sm font-medium">{discoveredAgent.name}</p>
                      {discoveredAgent.description && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {discoveredAgent.description}
                        </p>
                      )}
                      <p className="mt-1 text-xs font-mono text-muted-foreground">
                        {discoveredAgent.url}
                      </p>
                      {discoveredAgent.skills.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {discoveredAgent.skills.map((s) => (
                            <Badge key={s.id} variant="secondary" className="text-xs">
                              {s.name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="agent-name">Name</Label>
                    <Input
                      id="agent-name"
                      placeholder="My Code Agent"
                      value={agentForm.name}
                      onChange={(e) =>
                        setAgentForm((f) => ({ ...f, name: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="agent-key">API Key (optional)</Label>
                    <Input
                      id="agent-key"
                      type="password"
                      placeholder={agentEditingId ? "Leave empty to keep existing" : "Optional"}
                      value={agentForm.apiKey}
                      onChange={(e) =>
                        setAgentForm((f) => ({ ...f, apiKey: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="agent-auth">Auth Scheme</Label>
                    <select
                      id="agent-auth"
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={agentForm.authScheme}
                      onChange={(e) =>
                        setAgentForm((f) => ({ ...f, authScheme: e.target.value }))
                      }
                    >
                      <option value="bearer">Bearer Token</option>
                      <option value="api-key">API Key Header</option>
                    </select>
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogClose>
                  <Button
                    onClick={handleAgentSubmit}
                    disabled={isAgentPending || (!agentEditingId && !discoveredAgent)}
                  >
                    {isAgentPending && (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    )}
                    {agentEditingId ? "Save Changes" : "Add Agent"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {loadingAgents ? (
              <div className="h-24 animate-pulse rounded bg-muted" />
            ) : agentProviders.length === 0 ? (
              <EmptyState
                icon={<Bot className="h-6 w-6" />}
                title="No agent providers"
                description="Connect your first A2A agent to delegate fix generation"
              />
            ) : (
              <div className="space-y-3">
                {agentProviders.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-4 rounded-lg border p-4"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-violet-500/10">
                      <Bot className="h-5 w-5 text-violet-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.name}</span>
                        <Badge variant="outline" className="text-xs">
                          Agent
                        </Badge>
                        {p.isDefault && (
                          <Badge className="text-xs">
                            <Star className="mr-1 h-3 w-3" />
                            Default
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="font-mono">{p.endpoint}</span>
                        {p.maskedApiKey && <span>Key: {p.maskedApiKey}</span>}
                      </div>
                      {Array.isArray(p.cachedSkills) && p.cachedSkills.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {(p.cachedSkills as Array<{ id: string; name: string }>).slice(0, 5).map((s) => (
                            <Badge key={s.id} variant="secondary" className="text-xs">
                              {s.name}
                            </Badge>
                          ))}
                          {(p.cachedSkills as unknown[]).length > 5 && (
                            <Badge variant="secondary" className="text-xs">
                              +{(p.cachedSkills as unknown[]).length - 5} more
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => testAgentMutation.mutate(p.id)}
                        disabled={testAgentMutation.isPending}
                        title="Test connection"
                      >
                        {testAgentMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => refreshAgentMutation.mutate(p.id)}
                        disabled={refreshAgentMutation.isPending}
                        title="Refresh capabilities"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${refreshAgentMutation.isPending ? "animate-spin" : ""}`} />
                      </Button>
                      {!p.isDefault ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => agentDefaultMutation.mutate(p.id)}
                          disabled={agentDefaultMutation.isPending}
                          title="Set as default"
                        >
                          <Star className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => clearAgentDefaultMutation.mutate()}
                          disabled={clearAgentDefaultMutation.isPending}
                          title="Clear default"
                        >
                          <Star className="h-3.5 w-3.5 fill-current" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openAgentEdit(p)}
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Dialog
                        open={agentDeleteTarget === p.id}
                        onOpenChange={(o) => setAgentDeleteTarget(o ? p.id : null)}
                      >
                        <DialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Delete Agent Provider</DialogTitle>
                            <DialogDescription>
                              Are you sure you want to delete &quot;{p.name}&quot;? This cannot be undone.
                            </DialogDescription>
                          </DialogHeader>
                          <DialogFooter>
                            <DialogClose asChild>
                              <Button variant="outline">Cancel</Button>
                            </DialogClose>
                            <Button
                              variant="destructive"
                              onClick={() => deleteAgentMutation.mutate(p.id)}
                              disabled={deleteAgentMutation.isPending}
                            >
                              {deleteAgentMutation.isPending && (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              )}
                              Delete
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
