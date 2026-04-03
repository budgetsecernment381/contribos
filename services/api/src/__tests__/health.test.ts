import { describe, it, expect } from "vitest";
import { getHealth, getReady } from "../modules/health/health.service.js";

describe("health service", () => {
  it("getHealth returns valid shape", async () => {
    const result = await getHealth();
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("database");
    expect(result).toHaveProperty("redis");
    expect(result).toHaveProperty("queue");
    expect(result).toHaveProperty("timestamp");
    expect(["ok", "degraded"]).toContain(result.status);
  });

  it("getReady returns valid shape", async () => {
    const result = await getReady();
    expect(result).toHaveProperty("ready");
    expect(result).toHaveProperty("checks");
    expect(typeof result.ready).toBe("boolean");
  });
});
