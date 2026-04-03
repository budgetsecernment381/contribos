"""Configuration from environment variables."""

import os
from dotenv import load_dotenv

load_dotenv()

# LLM provider keys (at least one required)
CLAUDE_API_KEY: str = os.getenv("CLAUDE_API_KEY", "")
OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
GOOGLE_AI_API_KEY: str = os.getenv("GOOGLE_AI_API_KEY", "")
PERPLEXITY_API_KEY: str = os.getenv("PERPLEXITY_API_KEY", "")
MISTRAL_API_KEY: str = os.getenv("MISTRAL_API_KEY", "")
GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
DEEPSEEK_API_KEY: str = os.getenv("DEEPSEEK_API_KEY", "")
XAI_API_KEY: str = os.getenv("XAI_API_KEY", "")

# API callback
CALLBACK_URL: str = os.getenv("CALLBACK_URL", "")

# S3 (optional for local dev; worker can return artifacts inline)
S3_BUCKET: str = os.getenv("S3_BUCKET", "")
S3_REGION: str = os.getenv("S3_REGION", "us-east-1")

# Worker identity
WORKER_ID: str = os.getenv("WORKER_ID", "agent-worker-1")

# Execution timeout in seconds (default 10 minutes)
try:
    MAX_EXECUTION_TIME: int = int(os.getenv("MAX_EXECUTION_TIME", "600"))
except (ValueError, TypeError):
    MAX_EXECUTION_TIME: int = 600

# Service-to-service auth token (API <-> Worker)
WORKER_SERVICE_TOKEN: str = os.getenv("WORKER_SERVICE_TOKEN", "")
