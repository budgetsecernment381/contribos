"""Mistral AI provider adapter."""

from __future__ import annotations

from .base import register_adapter
from .openai_compatible import OpenAICompatibleAdapter


class MistralAdapter(OpenAICompatibleAdapter):
    """Adapter for Mistral AI's chat completions API (OpenAI-compatible)."""

    provider_id = "mistral"
    base_url = "https://api.mistral.ai/v1"
    env_key = "MISTRAL_API_KEY"


register_adapter("mistral", MistralAdapter)
