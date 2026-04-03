"""Perplexity provider adapter."""

from __future__ import annotations

from .base import register_adapter
from .openai_compatible import OpenAICompatibleAdapter


class PerplexityAdapter(OpenAICompatibleAdapter):
    """Adapter for Perplexity's Sonar API (OpenAI-compatible)."""

    provider_id = "perplexity"
    base_url = "https://api.perplexity.ai"
    env_key = "PERPLEXITY_API_KEY"


register_adapter("perplexity", PerplexityAdapter)
