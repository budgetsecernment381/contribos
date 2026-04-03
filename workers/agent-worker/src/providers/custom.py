"""Dynamic adapter for user-supplied custom (BYOK) LLM providers using OpenAI-compatible API."""

from __future__ import annotations

import json
import sys

import httpx

from .base import CompletionResult, ProviderAdapter


class CustomProviderAdapter(ProviderAdapter):
    """Adapter that uses user-supplied base_url, api_key, and model at runtime."""

    def __init__(self, base_url: str, api_key: str, model_id: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model_id = model_id

    def complete(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 4096,
    ) -> CompletionResult:
        effective_model = model if model else self._model_id

        payload = {
            "model": effective_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }

        response = httpx.post(
            self._base_url,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=300,
        )

        if not response.is_success:
            body = response.text[:500]
            print(
                json.dumps({
                    "msg": "custom_provider_error",
                    "status": response.status_code,
                    "url": self._base_url,
                    "model": effective_model,
                    "response_body": body,
                }),
                file=sys.stderr,
            )
            response.raise_for_status()

        data = response.json()

        return CompletionResult(
            text=data["choices"][0]["message"]["content"],
            input_tokens=data.get("usage", {}).get("prompt_tokens", 0),
            output_tokens=data.get("usage", {}).get("completion_tokens", 0),
            provider="custom",
            model=effective_model,
        )

    def is_available(self) -> bool:
        return bool(self._api_key)
