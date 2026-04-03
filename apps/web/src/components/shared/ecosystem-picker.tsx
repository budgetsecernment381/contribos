import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, X } from "lucide-react";

export const ECOSYSTEMS = [
  { value: "typescript", label: "TypeScript / React / Next.js" },
  { value: "javascript", label: "JavaScript / Node.js / Vue" },
  { value: "python", label: "Python" },
  { value: "rust", label: "Rust" },
  { value: "go", label: "Go" },
  { value: "java", label: "Java / Kotlin" },
  { value: "ruby", label: "Ruby" },
  { value: "swift", label: "Swift / iOS" },
  { value: "dotnet", label: "C# / .NET" },
  { value: "php", label: "PHP" },
  { value: "elixir", label: "Elixir / Erlang" },
  { value: "dart", label: "Dart / Flutter" },
];

const KNOWN_VALUES = new Set(ECOSYSTEMS.map((e) => e.value));

interface EcosystemPickerProps {
  selected: string[];
  onChange: (ecosystems: string[]) => void;
}

export function EcosystemPicker({ selected, onChange }: EcosystemPickerProps) {
  const [customInput, setCustomInput] = useState("");

  const customEcosystems = selected.filter((v) => !KNOWN_VALUES.has(v));

  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  function addCustom() {
    const trimmed = customInput.trim().toLowerCase().replace(/\s+/g, "-");
    if (!trimmed) return;
    if (selected.includes(trimmed)) {
      setCustomInput("");
      return;
    }
    onChange([...selected, trimmed]);
    setCustomInput("");
  }

  function removeCustom(value: string) {
    onChange(selected.filter((v) => v !== value));
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {ECOSYSTEMS.map((eco) => (
          <label
            key={eco.value}
            className={`flex cursor-pointer items-center gap-2.5 rounded-md border p-3 text-sm transition-colors hover:bg-accent ${
              selected.includes(eco.value)
                ? "border-primary bg-primary/5"
                : "border-input"
            }`}
          >
            <Checkbox
              checked={selected.includes(eco.value)}
              onCheckedChange={() => toggle(eco.value)}
            />
            <span>{eco.label}</span>
          </label>
        ))}
      </div>

      {customEcosystems.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {customEcosystems.map((eco) => (
            <Badge key={eco} variant="secondary" className="gap-1 pr-1">
              {eco}
              <button
                type="button"
                onClick={() => removeCustom(eco)}
                className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input
          placeholder="Type a custom language or framework..."
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addCustom}
          disabled={!customInput.trim()}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add
        </Button>
      </div>

      {selected.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {selected.length} selected
        </p>
      )}
    </div>
  );
}
