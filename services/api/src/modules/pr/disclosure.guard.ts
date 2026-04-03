import type { AppError } from "../../common/errors/app-error.js";
import { validationError } from "../../common/errors/app-error.js";

const REQUIRED_PHRASES = [
  "AI-assisted",
  "AI generated",
  "AI helped",
  "assisted by AI",
  "generated with AI",
];

/**
 * Ensures AI disclosure text is present and contains required phrasing.
 * Disclosure must not be empty and must include at least one required phrase.
 */
export function validateDisclosure(disclosureText: string): AppError | null {
  if (!disclosureText?.trim()) {
    return validationError("AI disclosure text is required");
  }

  const lower = disclosureText.toLowerCase();
  const hasPhrase = REQUIRED_PHRASES.some((p) => lower.includes(p.toLowerCase()));

  if (!hasPhrase) {
    return validationError(
      "Disclosure must include AI attribution (e.g. 'AI-assisted', 'AI generated')"
    );
  }

  return null;
}

/**
 * Check that the submitted disclosure matches the original (immutability).
 */
export function checkDisclosureUnchanged(
  original: string,
  submitted: string
): AppError | null {
  const norm = (s: string) => s.trim().toLowerCase();
  if (norm(original) !== norm(submitted)) {
    return validationError("Disclosure text must not be modified");
  }
  return null;
}
