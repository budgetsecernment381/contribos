"""Anthropic (Claude) provider adapter."""

from __future__ import annotations

import os

from anthropic import Anthropic

from .base import CompletionResult, ProviderAdapter, register_adapter


class AnthropicAdapter(ProviderAdapter):
    """Adapter for Anthropic's Claude API."""

    def complete(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 4096,
    ) -> CompletionResult:
        api_key = os.getenv("CLAUDE_API_KEY", "")
        if not api_key:
            raise RuntimeError("CLAUDE_API_KEY not configured")

        client = Anthropic(api_key=api_key)
        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )

        text = ""
        for block in response.content:
            if hasattr(block, "text"):
                text += block.text

        return CompletionResult(
            text=text,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
            provider="anthropic",
            model=model,
        )

    def is_available(self) -> bool:
        return bool(os.getenv("CLAUDE_API_KEY"))


register_adapter("anthropic", AnthropicAdapter)
