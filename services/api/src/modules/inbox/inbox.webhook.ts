import { createHmac, timingSafeEqual } from "crypto";
import type { FastifyRequest } from "fastify";

/**
 * Verify GitHub webhook signature using HMAC-SHA256.
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature?.startsWith("sha256=")) return false;

  const expected = signature.slice(7);
  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  const computed = hmac.digest("hex");

  if (computed.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(expected, "hex"));
}

/**
 * Extract raw body for webhook verification.
 * Fastify may parse JSON by default - we need raw body for signature.
 */
export function getRawBody(req: FastifyRequest): string | Buffer {
  return (req as FastifyRequest & { rawBody?: string | Buffer }).rawBody ?? JSON.stringify(req.body ?? {});
}
