"""Base provider adapter interface and registry."""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class CompletionResult:
    """Normalized completion result from any LLM provider."""

    text: str
    input_tokens: int
    output_tokens: int
    provider: str
    model: str


class ProviderAdapter(ABC):
    """Abstract base for LLM provider adapters."""

    @abstractmethod
    def complete(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 4096,
    ) -> CompletionResult:
        """Send a completion request and return normalized result."""

    @abstractmethod
    def is_available(self) -> bool:
        """Check if the provider is configured and reachable."""


_registry: dict[str, type[ProviderAdapter]] = {}


def register_adapter(provider_id: str, adapter_cls: type[ProviderAdapter]) -> None:
    """Register a provider adapter class."""
    _registry[provider_id] = adapter_cls


def get_adapter(provider_id: str) -> ProviderAdapter:
    """Instantiate and return the adapter for the given provider."""
    adapter_cls = _registry.get(provider_id)
    if adapter_cls is None:
        raise ValueError(f"No adapter registered for provider '{provider_id}'")
    return adapter_cls()
