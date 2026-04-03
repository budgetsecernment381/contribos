"""Pydantic models for job request/response."""

import re

from pydantic import BaseModel, Field, field_validator


class JobRequest(BaseModel):
    """Job execution request payload."""

    job_id: str = Field(..., description="Unique job identifier")
    issue_url: str = Field(..., description="URL of the GitHub issue")
    repo_url: str = Field(..., description="Repository clone URL")
    familiarity_level: str = Field(
        ..., description="never|occasional|regular|contributed"
    )
    fix_intent: str = Field(
        ..., description="minimal_safe|correct_complete|full_understanding"
    )
    free_context: str | None = Field(None, description="Optional free-form context")
    llm_provider: str = Field("anthropic", description="LLM provider: anthropic|openai|google|perplexity|mistral|groq|deepseek|xai")
    llm_model: str = Field("claude-sonnet-4-20250514", description="Model ID for the selected provider")
    custom_provider_base_url: str | None = Field(None, description="Custom BYOK provider base URL")
    custom_provider_api_key: str | None = Field(None, description="Custom BYOK provider API key")
    custom_provider_model: str | None = Field(None, description="Custom BYOK provider model ID")
    issue_title: str = Field("", description="Issue title from DB")
    issue_body: str = Field("", description="Issue body/description from DB")
    issue_labels: list[str] = Field(default_factory=list, description="Issue labels")
    agent_provider_endpoint: str | None = Field(None, description="A2A agent provider endpoint URL")
    agent_provider_api_key: str | None = Field(None, description="A2A agent provider API key")
    agent_provider_auth_scheme: str = Field("bearer", description="A2A agent auth scheme")
    agent_provider_name: str | None = Field(None, description="A2A agent provider name")

    @field_validator("repo_url", "issue_url")
    @classmethod
    def validate_urls(cls, v: str) -> str:
        if not v.startswith(("https://", "http://")):
            raise ValueError("URL must use http or https scheme")
        return v

    @field_validator("agent_provider_endpoint", "custom_provider_base_url")
    @classmethod
    def validate_provider_urls(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if not v.startswith(("https://", "http://")):
            raise ValueError("Provider URL must use http or https scheme")
        _PRIVATE_PATTERNS = [
            r"^https?://10\.", r"^https?://172\.(1[6-9]|2\d|3[01])\.",
            r"^https?://192\.168\.", r"^https?://127\.", r"^https?://0\.",
            r"^https?://169\.254\.", r"^https?://localhost[:/]",
            r"^https?://\[::1\]",
        ]
        for pattern in _PRIVATE_PATTERNS:
            if re.match(pattern, v, re.IGNORECASE):
                raise ValueError("Provider URL must not point to a private network address")
        return v


class ArtifactPackage(BaseModel):
    """Artifact package returned after job execution."""

    diff: str = Field("", description="Unified diff of proposed changes")
    execution_trace: str = Field("", description="Execution trace/log")
    confidence_score: float = Field(0.0, ge=0, le=100, description="0-100 confidence")
    test_results: str = Field("", description="Test run output if available")
    changed_files: list[str] = Field(default_factory=list, description="List of changed file paths")
    summary: str = Field("", description="Human-readable summary of the fix")
    risk_flags: list[str] = Field(
        default_factory=list, description="Detected risk flags (e.g. secrets)"
    )


class JobResponse(BaseModel):
    """Response envelope for job execution."""

    ok: bool = Field(..., description="Whether execution succeeded")
    job_id: str = Field(..., description="Job identifier")
    artifacts: ArtifactPackage | None = Field(None, description="Artifacts when ok")
    error: str | None = Field(None, description="Error message when not ok")
