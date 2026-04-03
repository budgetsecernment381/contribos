"""xAI (Grok) provider adapter."""

from __future__ import annotations

from .base import register_adapter
from .openai_compatible import OpenAICompatibleAdapter


class XAIAdapter(OpenAICompatibleAdapter):
    """Adapter for xAI's Grok API (OpenAI-compatible)."""

    provider_id = "xai"
    base_url = "https://api.x.ai/v1"
    env_key = "XAI_API_KEY"


register_adapter("xai", XAIAdapter)
