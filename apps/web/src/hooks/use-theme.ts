import { useTheme as useNextThemes } from "next-themes";
import { useCallback, useEffect, useState } from "react";

export function useTheme() {
  const { theme, setTheme, resolvedTheme } = useNextThemes();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggle = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  return {
    theme: mounted ? theme : undefined,
    resolvedTheme: mounted ? resolvedTheme : undefined,
    setTheme,
    toggle,
    isDark: resolvedTheme === "dark",
    mounted,
  };
}
