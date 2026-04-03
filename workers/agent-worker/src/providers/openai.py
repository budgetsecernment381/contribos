"""OpenAI provider adapter."""

from __future__ import annotations

from .base import register_adapter
from .openai_compatible import OpenAICompatibleAdapter


class OpenAIAdapter(OpenAICompatibleAdapter):
    """Adapter for OpenAI's chat completions API."""

    provider_id = "openai"
    base_url = "https://api.openai.com/v1"
    env_key = "OPENAI_API_KEY"


register_adapter("openai", OpenAIAdapter)
