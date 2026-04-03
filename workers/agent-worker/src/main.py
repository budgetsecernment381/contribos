"""FastAPI application for the agent worker."""

import asyncio
import logging
import multiprocessing
import traceback
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse

from .config import (
    CLAUDE_API_KEY,
    OPENAI_API_KEY,
    GOOGLE_AI_API_KEY,
    PERPLEXITY_API_KEY,
    MISTRAL_API_KEY,
    GROQ_API_KEY,
    DEEPSEEK_API_KEY,
    XAI_API_KEY,
    MAX_EXECUTION_TIME,
    WORKER_SERVICE_TOKEN,
)
from .executor import execute_job
from .models import ArtifactPackage, JobRequest, JobResponse

logger = logging.getLogger(__name__)

app = FastAPI(title="ContribOS Agent Worker", version="0.1.0")


def verify_service_token(
    authorization: str | None = Header(None),
) -> None:
    """Validate the service-to-service auth token on protected endpoints."""
    if not WORKER_SERVICE_TOKEN:
        import os
        if os.getenv("WORKER_ENV", "development") == "production":
            raise HTTPException(
                status_code=503,
                detail="WORKER_SERVICE_TOKEN must be configured in production",
            )
        # SECURITY: Without a service token, /execute accepts any caller on reachable
        # interfaces—fine for isolated local dev only; never expose that setup to untrusted networks.
        logger.warning(
            "WORKER_SERVICE_TOKEN is unset: skipping service auth (non-production only). "
            "Do not expose this worker to untrusted networks."
        )
        return
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or token != WORKER_SERVICE_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid service token")


def _run_job_in_process(
    job_id: str,
    issue_url: str,
    repo_url: str,
    familiarity_level: str,
    fix_intent: str,
    free_context: str | None,
    llm_provider: str,
    llm_model: str,
    result_dict: dict[str, Any],
    custom_provider_base_url: str | None = None,
    custom_provider_api_key: str | None = None,
    custom_provider_model: str | None = None,
    issue_title: str = "",
    issue_body: str = "",
    issue_labels: list[str] | None = None,
    agent_provider_endpoint: str | None = None,
    agent_provider_api_key: str | None = None,
    agent_provider_auth_scheme: str = "bearer",
    agent_provider_name: str | None = None,
) -> None:
    """Target function for multiprocessing. Stores result in shared dict."""
    try:
        artifacts = execute_job(
            job_id=job_id,
            issue_url=issue_url,
            repo_url=repo_url,
            familiarity_level=familiarity_level,
            fix_intent=fix_intent,
            free_context=free_context,
            llm_provider=llm_provider,
            llm_model=llm_model,
            custom_provider_base_url=custom_provider_base_url,
            custom_provider_api_key=custom_provider_api_key,
            custom_provider_model=custom_provider_model,
            issue_title=issue_title,
            issue_body=issue_body,
            issue_labels=issue_labels or [],
            agent_provider_endpoint=agent_provider_endpoint,
            agent_provider_api_key=agent_provider_api_key,
            agent_provider_auth_scheme=agent_provider_auth_scheme,
            agent_provider_name=agent_provider_name,
        )
        result_dict["artifacts"] = artifacts.model_dump()
        result_dict["ok"] = True
    except Exception as exc:
        result_dict["ok"] = False
        tb = traceback.format_exc(limit=5)
        result_dict["error"] = f"{type(exc).__name__}: {exc}\n{tb[-1200:]}"


@app.post("/execute", response_model=JobResponse, dependencies=[Depends(verify_service_token)])
async def execute(request: JobRequest) -> JobResponse:
    """
    Receive job execution request, run analysis, return artifacts.
    Uses asyncio.to_thread to avoid blocking the event loop.
    Uses multiprocessing with timeout so the process can be killed.
    """
    manager = None
    try:
        manager = multiprocessing.Manager()
        result_dict: dict[str, Any] = manager.dict()
        result_dict["ok"] = False

        proc = multiprocessing.Process(
            target=_run_job_in_process,
            args=(
                request.job_id,
                request.issue_url,
                request.repo_url,
                request.familiarity_level,
                request.fix_intent,
                request.free_context,
                request.llm_provider,
                request.llm_model,
            ),
            kwargs={
                "result_dict": result_dict,
                "custom_provider_base_url": request.custom_provider_base_url,
                "custom_provider_api_key": request.custom_provider_api_key,
                "custom_provider_model": request.custom_provider_model,
                "issue_title": request.issue_title,
                "issue_body": request.issue_body,
                "issue_labels": request.issue_labels,
                "agent_provider_endpoint": request.agent_provider_endpoint,
                "agent_provider_api_key": request.agent_provider_api_key,
                "agent_provider_auth_scheme": request.agent_provider_auth_scheme,
                "agent_provider_name": request.agent_provider_name,
            },
        )
        proc.start()

        await asyncio.to_thread(proc.join, timeout=MAX_EXECUTION_TIME)

        if proc.is_alive():
            proc.kill()
            proc.join(timeout=5)
            return JobResponse(
                ok=False,
                job_id=request.job_id,
                artifacts=None,
                error=f"Execution timed out after {MAX_EXECUTION_TIME}s",
            )

        if result_dict.get("ok") and result_dict.get("artifacts"):
            return JobResponse(
                ok=True,
                job_id=request.job_id,
                artifacts=ArtifactPackage(**result_dict["artifacts"]),
                error=None,
            )

        return JobResponse(
            ok=False,
            job_id=request.job_id,
            artifacts=None,
            error=result_dict.get("error", "Execution failed"),
        )

    except Exception:
        logger.exception(
            "Unhandled error in /execute for job_id=%s",
            request.job_id,
        )
        return JobResponse(
            ok=False,
            job_id=request.job_id,
            artifacts=None,
            error="Internal worker error",
        )
    finally:
        if manager is not None:
            try:
                manager.shutdown()
            except Exception:
                pass


@app.get("/health")
@app.post("/health")
async def health() -> JSONResponse:
    """Health check with basic dependency verification."""
    checks: dict[str, str] = {}

    providers_count = sum(
        1 for k in [
            CLAUDE_API_KEY, OPENAI_API_KEY, GOOGLE_AI_API_KEY,
            PERPLEXITY_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY,
            DEEPSEEK_API_KEY, XAI_API_KEY,
        ] if k
    )
    checks["model_provider"] = "ok" if providers_count > 0 else "not_configured"

    try:
        import shutil
        import tempfile
        tmp = tempfile.mkdtemp(prefix="healthcheck-")
        shutil.rmtree(tmp)
        checks["filesystem"] = "ok"
    except Exception:
        checks["filesystem"] = "error"

    all_ok = all(v == "ok" for v in checks.values())
    status_code = 200 if all_ok else 503

    return JSONResponse(
        content={"status": "ok" if all_ok else "degraded", "checks": checks},
        status_code=status_code,
    )
