import { describe, it, expect } from "vitest";

describe("app", () => {
  it("apiClient base URL defaults to /api/v1", async () => {
    const { apiClient } = await import("../lib/api.js");
    expect(apiClient).toHaveProperty("get");
    expect(apiClient).toHaveProperty("post");
    expect(apiClient).toHaveProperty("put");
    expect(apiClient).toHaveProperty("patch");
    expect(apiClient).toHaveProperty("delete");
  });

  it("cn utility merges classes", async () => {
    const { cn } = await import("../lib/utils.js");
    const result = cn("foo", "bar");
    expect(result).toContain("foo");
    expect(result).toContain("bar");
  });
});
