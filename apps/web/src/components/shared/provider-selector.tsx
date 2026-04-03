import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiClient } from "@/lib/api";
import { Cpu, Zap, Bot } from "lucide-react";

interface CatalogProvider {
  id: string;
  name: string;
  source: "built_in" | "custom" | "agent";
  models: { id: string; name: string }[];
  modelId?: string;
  isDefault?: boolean;
  skills?: unknown;
}

interface ProviderSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export function ProviderSelector({ value, onChange }: ProviderSelectorProps) {
  const { data } = useQuery({
    queryKey: ["provider-catalog"],
    queryFn: () =>
      apiClient.get<{ providers: CatalogProvider[] }>("/ai/providers"),
    staleTime: 5 * 60 * 1000,
  });

  const providers = data?.providers ?? [];
  const builtIn = providers.filter((p) => p.source === "built_in");
  const custom = providers.filter((p) => p.source === "custom");
  const agents = providers.filter((p) => p.source === "agent");

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Default provider" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="default">System Default</SelectItem>

        {builtIn.length > 0 && (
          <SelectGroup>
            <SelectLabel className="flex items-center gap-1.5">
              <Cpu className="h-3 w-3" />
              Built-in
            </SelectLabel>
            {builtIn.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}

        {custom.length > 0 && (
          <SelectGroup>
            <SelectLabel className="flex items-center gap-1.5">
              <Zap className="h-3 w-3" />
              Custom
            </SelectLabel>
            {custom.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {p.isDefault ? " (default)" : ""}
              </SelectItem>
            ))}
          </SelectGroup>
        )}

        {agents.length > 0 && (
          <SelectGroup>
            <SelectLabel className="flex items-center gap-1.5">
              <Bot className="h-3 w-3" />
              Agents (A2A)
            </SelectLabel>
            {agents.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {p.isDefault ? " (default)" : ""}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
