import * as React from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface DiffViewerProps {
  diff: string;
  className?: string;
}

function parseUnifiedDiff(diff: string): { lineNum: number; content: string; type: "add" | "remove" | "context" }[] {
  const lines = diff.split("\n");
  const result: { lineNum: number; content: string; type: "add" | "remove" | "context" }[] = [];
  let addNum = 0;
  let removeNum = 0;

  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      addNum++;
      result.push({ lineNum: addNum, content: line, type: "add" });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removeNum++;
      result.push({ lineNum: removeNum, content: line, type: "remove" });
    } else {
      result.push({ lineNum: result.length + 1, content: line, type: "context" });
    }
  }
  return result;
}

export function DiffViewer({ diff, className }: DiffViewerProps) {
  const lines = React.useMemo(() => parseUnifiedDiff(diff), [diff]);

  return (
    <ScrollArea className={cn("h-[400px] rounded-md border", className)}>
      <pre className="p-4 font-mono text-xs leading-relaxed">
        <code>
          {lines.map((line, i) => (
            <div
              key={i}
              className={cn(
                "flex",
                line.type === "add" && "bg-success/10 text-[hsl(var(--syntax-added))]",
                line.type === "remove" && "bg-destructive/10 text-[hsl(var(--syntax-removed))]"
              )}
            >
              <span className="w-12 shrink-0 select-none pr-4 text-right text-[hsl(var(--syntax-line-number))]">
                {line.type !== "context" ? line.lineNum : ""}
              </span>
              <span className="shrink-0 w-6 text-center">
                {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
              </span>
              <span className="break-all">{line.content.slice(1) || " "}</span>
            </div>
          ))}
        </code>
      </pre>
    </ScrollArea>
  );
}
