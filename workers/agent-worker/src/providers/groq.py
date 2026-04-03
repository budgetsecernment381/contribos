"""Groq provider adapter."""

from __future__ import annotations

from .base import register_adapter
from .openai_compatible import OpenAICompatibleAdapter


class GroqAdapter(OpenAICompatibleAdapter):
    """Adapter for Groq's inference API (OpenAI-compatible)."""

    provider_id = "groq"
    base_url = "https://api.groq.com/openai/v1"
    env_key = "GROQ_API_KEY"


register_adapter("groq", GroqAdapter)
