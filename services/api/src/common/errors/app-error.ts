/**
 * Standard application error with code, status code, and message.
 * Used for consistent error handling across the API.
 */
export type AppErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "CREDIT_INSUFFICIENT"
  | "GATE_FAILED"
  | "REVIEW_NOT_ELIGIBLE"
  | "CLAIM_CONFLICT"
  | "ALREADY_SUBMITTED"
  | "PROVIDER_UNAVAILABLE";

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
    Object.setPrototypeOf(this, AppError.prototype);
  }

  toJSON(): Record<string, unknown> {
    const obj: Record<string, unknown> = {
      code: this.code,
      message: this.message,
    };
    if (this.details !== undefined) obj.details = this.details;
    return obj;
  }
}

/** Create UNAUTHORIZED (401) error */
export function unauthorized(message = "Unauthorized"): AppError {
  return new AppError("UNAUTHORIZED", 401, message);
}

/** Create FORBIDDEN (403) error */
export function forbidden(message = "Forbidden"): AppError {
  return new AppError("FORBIDDEN", 403, message);
}

/** Create NOT_FOUND (404) error */
export function notFound(message = "Not found"): AppError {
  return new AppError("NOT_FOUND", 404, message);
}

/** Create VALIDATION_ERROR (400) error */
export function validationError(
  message = "Validation failed",
  details?: unknown
): AppError {
  return new AppError("VALIDATION_ERROR", 400, message, details);
}

/** Create CONFLICT (409) error */
export function conflict(message = "Conflict"): AppError {
  return new AppError("CONFLICT", 409, message);
}

/** Create RATE_LIMITED (429) error */
export function rateLimited(message = "Too many requests"): AppError {
  return new AppError("RATE_LIMITED", 429, message);
}

/** Create INTERNAL_ERROR (500) error */
export function internalError(message = "Internal server error"): AppError {
  return new AppError("INTERNAL_ERROR", 500, message);
}

/** Create CREDIT_INSUFFICIENT (402) error */
export function creditInsufficient(message = "Insufficient credits"): AppError {
  return new AppError("CREDIT_INSUFFICIENT", 402, message);
}

/** Create GATE_FAILED (400) error */
export function gateFailed(message = "Quality gate failed"): AppError {
  return new AppError("GATE_FAILED", 400, message);
}

/** Create REVIEW_NOT_ELIGIBLE (400) error */
export function reviewNotEligible(
  message = "Review not eligible for this action"
): AppError {
  return new AppError("REVIEW_NOT_ELIGIBLE", 400, message);
}

/** Create CLAIM_CONFLICT (409) error */
export function claimConflict(message = "Issue already claimed"): AppError {
  return new AppError("CLAIM_CONFLICT", 409, message);
}

/** Create ALREADY_SUBMITTED (409) error */
export function alreadySubmitted(
  message = "PR already submitted for this review"
): AppError {
  return new AppError("ALREADY_SUBMITTED", 409, message);
}

/** Create PROVIDER_UNAVAILABLE (502) error */
export function providerUnavailable(
  message = "LLM provider is unavailable"
): AppError {
  return new AppError("PROVIDER_UNAVAILABLE", 502, message);
}
