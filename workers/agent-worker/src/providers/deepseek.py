"""DeepSeek provider adapter."""

from __future__ import annotations

from .base import register_adapter
from .openai_compatible import OpenAICompatibleAdapter


class DeepSeekAdapter(OpenAICompatibleAdapter):
    """Adapter for DeepSeek's chat completions API (OpenAI-compatible)."""

    provider_id = "deepseek"
    base_url = "https://api.deepseek.com/v1"
    env_key = "DEEPSEEK_API_KEY"


register_adapter("deepseek", DeepSeekAdapter)
