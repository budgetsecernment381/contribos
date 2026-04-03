import type { AppError } from "../errors/app-error.js";

/**
 * Generic Result type for service layer return values.
 * Either success with data or failure with error.
 */
export type Result<T, E = AppError> =
  | { ok: true; data: T }
  | { ok: false; error: E };

/** Create a success result */
export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

/** Create a failure result */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
