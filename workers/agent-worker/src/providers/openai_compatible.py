"""Reusable adapter for LLM providers that implement the OpenAI chat completions schema."""

from __future__ import annotations

import os

import httpx

from .base import CompletionResult, ProviderAdapter, register_adapter


class OpenAICompatibleAdapter(ProviderAdapter):
    """Base adapter for providers using the OpenAI-compatible chat/completions API.

    Subclasses only need to set provider_id, base_url, and env_key.
    """

    provider_id: str = ""
    base_url: str = ""
    env_key: str = ""

    def complete(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 4096,
    ) -> CompletionResult:
        api_key = os.getenv(self.env_key, "")
        if not api_key:
            raise RuntimeError(f"{self.env_key} not configured")

        response = httpx.post(
            f"{self.base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": max_tokens,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            },
            timeout=300,
        )
        response.raise_for_status()
        data = response.json()

        return CompletionResult(
            text=data["choices"][0]["message"]["content"],
            input_tokens=data["usage"]["prompt_tokens"],
            output_tokens=data["usage"]["completion_tokens"],
            provider=self.provider_id,
            model=model,
        )

    def is_available(self) -> bool:
        return bool(os.getenv(self.env_key))
