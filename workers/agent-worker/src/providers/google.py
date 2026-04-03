"""Google Generative AI provider adapter."""

from __future__ import annotations

import os

from .base import CompletionResult, ProviderAdapter, register_adapter


class GoogleAdapter(ProviderAdapter):
    """Adapter for Google's Generative AI API (Gemini)."""

    def complete(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 4096,
    ) -> CompletionResult:
        api_key = os.getenv("GOOGLE_AI_API_KEY", "")
        if not api_key:
            raise RuntimeError("GOOGLE_AI_API_KEY not configured")

        import httpx

        url = (
            f"https://generativelanguage.googleapis.com/v1beta/"
            f"models/{model}:generateContent?key={api_key}"
        )

        payload = {
            "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "generationConfig": {"maxOutputTokens": max_tokens},
        }

        response = httpx.post(url, json=payload, timeout=300)
        response.raise_for_status()
        data = response.json()

        text = ""
        for candidate in data.get("candidates", []):
            for part in candidate.get("content", {}).get("parts", []):
                text += part.get("text", "")

        usage = data.get("usageMetadata", {})

        return CompletionResult(
            text=text,
            input_tokens=usage.get("promptTokenCount", 0),
            output_tokens=usage.get("candidatesTokenCount", 0),
            provider="google",
            model=model,
        )

    def is_available(self) -> bool:
        return bool(os.getenv("GOOGLE_AI_API_KEY"))


register_adapter("google", GoogleAdapter)
