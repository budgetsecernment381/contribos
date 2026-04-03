import type { FastifyError, FastifyRequest, FastifyReply } from "fastify";
import { AppError } from "../errors/app-error.js";

/**
 * Global Fastify error handler that maps AppError to HTTP responses.
 * Other errors are logged and returned as 500.
 */
export async function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (error instanceof AppError) {
    reply.status(error.statusCode).send(error.toJSON());
    return;
  }

  if (error.validation) {
    reply.status(400).send({
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      details: error.validation,
    });
    return;
  }

  request.log?.error?.(error, "Unhandled error");
  reply.status(500).send({
    code: "INTERNAL_ERROR",
    message: "Internal server error",
  });
}
