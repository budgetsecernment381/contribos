"""A2A (Agent-to-Agent) protocol adapter for the Python worker.

Implements a JSON-RPC 2.0 client that sends tasks to external A2A agents,
polls for completion, and extracts diff artifacts from the response.
"""

import re
import time
import uuid
from dataclasses import dataclass, field

import httpx

DIFF_MARKERS = ("diff --git", "--- a/", "+++ b/", "--- ", "+++ ", "@@ -")

TASK_POLL_INTERVAL_S = 2.0
TASK_DEFAULT_TIMEOUT_S = 600  # 10 minutes
REQUEST_TIMEOUT_S = 30.0


@dataclass
class A2ATaskResult:
    """Result of an A2A task execution."""

    task_id: str
    state: str  # completed | failed | canceled
    diff_text: str = ""
    raw_text: str = ""
    error_message: str = ""
    latency_s: float = 0.0
    artifacts: list[dict] = field(default_factory=list)


def _build_auth_headers(
    api_key: str | None = None,
    auth_scheme: str = "bearer",
) -> dict[str, str]:
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if not api_key:
        return headers
    scheme = auth_scheme.lower()
    if scheme in ("api-key", "apikey"):
        headers["x-api-key"] = api_key
    else:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _jsonrpc_request(method: str, params: dict) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": method,
        "params": params,
    }


def _extract_diff(artifacts: list[dict]) -> str:
    """Scan A2A artifacts for unified diff content."""
    for artifact in artifacts:
        for part in artifact.get("parts", []):
            if part.get("type") == "text":
                text = part.get("text", "")
                if any(m in text for m in DIFF_MARKERS):
                    cleaned = text.strip()
                    if cleaned.startswith("```"):
                        first_nl = cleaned.find("\n")
                        cleaned = cleaned[first_nl + 1 :]
                        if cleaned.endswith("```"):
                            cleaned = cleaned[:-3]
                    return cleaned.strip()

    for artifact in artifacts:
        for part in artifact.get("parts", []):
            if part.get("type") == "text" and part.get("text", "").strip():
                return part["text"].strip()

    return ""


def send_task_and_poll(
    endpoint: str,
    prompt: str,
    api_key: str | None = None,
    auth_scheme: str = "bearer",
    timeout_s: float = TASK_DEFAULT_TIMEOUT_S,
) -> A2ATaskResult:
    """Send an A2A task and poll until terminal state.

    Returns an A2ATaskResult with the extracted diff or error info.
    """
    task_id = str(uuid.uuid4())
    headers = _build_auth_headers(api_key, auth_scheme)
    start = time.monotonic()

    terminal_states = {"completed", "failed", "canceled"}

    message = {
        "role": "user",
        "parts": [{"type": "text", "text": prompt}],
    }

    send_body = _jsonrpc_request("tasks/send", {"id": task_id, "message": message})

    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT_S) as client:
            resp = client.post(endpoint, json=send_body, headers=headers)
            resp.raise_for_status()
            rpc = resp.json()

            if "error" in rpc and rpc["error"]:
                return A2ATaskResult(
                    task_id=task_id,
                    state="failed",
                    error_message=f"JSON-RPC error {rpc['error'].get('code')}: {rpc['error'].get('message', '')}",
                    latency_s=time.monotonic() - start,
                )

            result = rpc.get("result", {})
            status = result.get("status", {})
            state = status.get("state", "submitted")
            artifacts = result.get("artifacts", [])

            if state in terminal_states:
                diff = _extract_diff(artifacts) if state == "completed" else ""
                return A2ATaskResult(
                    task_id=task_id,
                    state=state,
                    diff_text=diff,
                    raw_text=diff,
                    error_message=_extract_error(status) if state == "failed" else "",
                    latency_s=time.monotonic() - start,
                    artifacts=artifacts,
                )

            deadline = time.monotonic() + timeout_s
            while time.monotonic() < deadline:
                time.sleep(TASK_POLL_INTERVAL_S)

                get_body = _jsonrpc_request("tasks/get", {"id": task_id})
                poll_resp = client.post(endpoint, json=get_body, headers=headers)
                poll_resp.raise_for_status()
                poll_rpc = poll_resp.json()

                if "error" in poll_rpc and poll_rpc["error"]:
                    return A2ATaskResult(
                        task_id=task_id,
                        state="failed",
                        error_message=f"Poll error: {poll_rpc['error'].get('message', '')}",
                        latency_s=time.monotonic() - start,
                    )

                poll_result = poll_rpc.get("result", {})
                poll_status = poll_result.get("status", {})
                state = poll_status.get("state", "working")
                artifacts = poll_result.get("artifacts", [])

                if state in terminal_states:
                    diff = _extract_diff(artifacts) if state == "completed" else ""
                    return A2ATaskResult(
                        task_id=task_id,
                        state=state,
                        diff_text=diff,
                        raw_text=diff,
                        error_message=_extract_error(poll_status) if state == "failed" else "",
                        latency_s=time.monotonic() - start,
                        artifacts=artifacts,
                    )

                if state == "input-required":
                    return A2ATaskResult(
                        task_id=task_id,
                        state="failed",
                        error_message="Agent requires additional input — not supported",
                        latency_s=time.monotonic() - start,
                    )

            _cancel_task(client, endpoint, task_id, headers)
            return A2ATaskResult(
                task_id=task_id,
                state="failed",
                error_message=f"Task timed out after {int(timeout_s)}s",
                latency_s=time.monotonic() - start,
            )

    except httpx.HTTPStatusError as e:
        return A2ATaskResult(
            task_id=task_id,
            state="failed",
            error_message=f"HTTP {e.response.status_code}: {str(e)[:200]}",
            latency_s=time.monotonic() - start,
        )
    except (httpx.ConnectError, httpx.TimeoutException) as e:
        return A2ATaskResult(
            task_id=task_id,
            state="failed",
            error_message=f"Agent unreachable: {type(e).__name__}: {str(e)[:200]}",
            latency_s=time.monotonic() - start,
        )
    except Exception as e:
        return A2ATaskResult(
            task_id=task_id,
            state="failed",
            error_message=f"Unexpected error: {type(e).__name__}: {str(e)[:200]}",
            latency_s=time.monotonic() - start,
        )


def _extract_error(status: dict) -> str:
    msg = status.get("message", {})
    if isinstance(msg, dict):
        parts = msg.get("parts", [])
        texts = [p.get("text", "") for p in parts if p.get("type") == "text"]
        if texts:
            return " ".join(texts)[:500]
    return "Task failed without details"


def _cancel_task(
    client: httpx.Client,
    endpoint: str,
    task_id: str,
    headers: dict[str, str],
) -> None:
    try:
        body = _jsonrpc_request("tasks/cancel", {"id": task_id})
        client.post(endpoint, json=body, headers=headers)
    except Exception:
        pass
