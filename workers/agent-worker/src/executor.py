"""Job executor: clone repo, analyze issue, call LLM provider, generate diff, run tests."""

import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from .models import ArtifactPackage
from .providers import get_adapter
from .providers.custom import CustomProviderAdapter
from .a2a_adapter import send_task_and_poll


SECRET_PATTERNS = [
    r"(?i)(api[_-]?key|apikey)\s*=\s*['\"][^'\"]+['\"]",
    r"(?i)(secret|password|passwd|pwd)\s*=\s*['\"][^'\"]+['\"]",
    r"(?i)(token|bearer)\s*=\s*['\"][^'\"]+['\"]",
    r"(?i)aws[_-]?secret[_-]?access[_-]?key\s*=\s*['\"][^'\"]+['\"]",
    r"(?i)private[_-]?key\s*=\s*['\"][^'\"]+['\"]",
    r"-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----",
    r"sk-[a-zA-Z0-9]{20,}",
    r"ghp_[a-zA-Z0-9]{36}",
]

STOPWORDS = frozenset({
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "must", "ought",
    "i", "me", "my", "we", "our", "you", "your", "he", "she", "it",
    "they", "them", "their", "its", "this", "that", "these", "those",
    "in", "on", "at", "to", "for", "of", "with", "by", "from", "as",
    "into", "through", "during", "before", "after", "above", "below",
    "between", "under", "over", "up", "down", "out", "off", "about",
    "not", "no", "nor", "but", "or", "and", "if", "then", "else",
    "when", "where", "how", "what", "which", "who", "whom", "why",
    "all", "each", "every", "both", "few", "more", "most", "other",
    "some", "such", "than", "too", "very", "just", "also", "so",
    "add", "fix", "bug", "error", "issue", "problem", "please",
    "see", "use", "using", "used", "like", "get", "set", "new",
    "try", "make", "work", "want", "here", "there",
})

SOURCE_EXTS = frozenset({
    ".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".java",
    ".c", ".cpp", ".h", ".hpp", ".cs", ".rb", ".php", ".swift",
    ".kt", ".scala", ".vue", ".svelte",
})

CONFIG_FILES = frozenset({
    "readme.md", "readme.rst", "readme.txt", "readme",
    "package.json", "tsconfig.json", "pyproject.toml", "setup.py",
    "cargo.toml", "go.mod", "build.gradle", "pom.xml",
    "makefile", "dockerfile", "docker-compose.yml",
    ".eslintrc.js", ".eslintrc.json", "jest.config.js", "jest.config.ts",
    "vite.config.ts", "next.config.js", "next.config.mjs",
})

MAX_FILE_READ_BYTES = 4096
MAX_CONTEXT_CHARS = 200_000
MAX_ISSUE_BODY_CHARS = 50_000
MAX_SELECTED_FILES = 20


def _build_file_tree(repo_path: Path) -> list[str]:
    """Get the full file listing from the repo using git ls-tree. Returns list of relative paths."""
    try:
        result = subprocess.run(
            ["git", "ls-tree", "-r", "--name-only", "HEAD"],
            cwd=repo_path,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            return [line for line in result.stdout.strip().splitlines() if line]
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    # Fallback: walk the filesystem (skip common noise dirs)
    skip_dirs = {"node_modules", ".git", "dist", "build", "__pycache__", ".next", "vendor", "target", ".venv", "venv"}
    paths: list[str] = []
    for root, dirs, files in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for f in files:
            full = (Path(root) / f).resolve()
            if not full.is_relative_to(repo_path.resolve()):
                continue
            try:
                paths.append(str(full.relative_to(repo_path)))
            except ValueError:
                pass
    return paths


def _extract_keywords(title: str, body: str, labels: list[str]) -> list[str]:
    """Extract meaningful keywords from the issue title, body, and labels."""
    raw = f"{title} {body} {' '.join(labels)}"
    tokens = re.split(r"[^a-zA-Z0-9_./\\-]+", raw)
    keywords: list[str] = []
    seen: set[str] = set()
    for tok in tokens:
        tok_lower = tok.lower().strip(".-_/\\")
        if not tok_lower or len(tok_lower) < 2 or tok_lower in STOPWORDS:
            continue
        if tok_lower not in seen:
            seen.add(tok_lower)
            keywords.append(tok_lower)
    return keywords


def _extract_path_mentions(body: str) -> list[str]:
    """Extract file paths explicitly mentioned in the issue body."""
    pattern = r'(?:^|\s|`)((?:[\w.-]+/)+[\w.-]+\.[\w]+)'
    matches = re.findall(pattern, body)
    return list(dict.fromkeys(matches))


def _score_files(
    file_tree: list[str],
    keywords: list[str],
    path_mentions: list[str],
) -> list[tuple[str, int]]:
    """Score each file by keyword relevance. Returns sorted list of (path, score) with score > 0."""
    scored: list[tuple[str, int]] = []
    keyword_set = set(keywords)

    for fpath in file_tree:
        fpath_lower = fpath.lower()

        # Skip non-source files unless they're known config files
        base = fpath_lower.rsplit("/", 1)[-1]
        _, ext = os.path.splitext(base)
        if ext not in SOURCE_EXTS and base not in CONFIG_FILES:
            continue

        # Skip test fixtures, snapshots, generated code, lockfiles
        if any(seg in fpath_lower for seg in (
            "__snapshots__", "fixtures/", "testdata/", ".min.", "package-lock", "yarn.lock", "pnpm-lock",
        )):
            continue

        score = 0

        # Exact path mention in issue body
        for mention in path_mentions:
            if fpath_lower == mention.lower() or fpath_lower.endswith("/" + mention.lower()):
                score += 50

        # Keyword matches against path components
        parts = re.split(r"[/\\._-]", fpath_lower)
        for kw in keyword_set:
            # Full component match
            if kw in parts:
                score += 10
            # Substring match in path
            elif kw in fpath_lower:
                score += 5

        # Small boost for entry-point / config files
        if base in CONFIG_FILES:
            score += 2

        if score > 0:
            scored.append((fpath, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    return scored


def _select_relevant_files(
    repo_path: Path,
    scored_files: list[tuple[str, int]],
    file_tree: list[str],
) -> list[tuple[str, str]]:
    """Read the top scored files within the budget. Returns list of (rel_path, content).
    Falls back to config/entry-point files if no keyword matches found."""
    if not scored_files:
        # Fallback: grab config and entry-point files
        fallback_candidates = [
            f for f in file_tree
            if f.lower().rsplit("/", 1)[-1] in CONFIG_FILES
        ]
        scored_files = [(f, 1) for f in fallback_candidates[:MAX_SELECTED_FILES]]

    selected: list[tuple[str, str]] = []
    total_chars = 0
    budget = MAX_CONTEXT_CHARS

    for fpath, _score in scored_files[:MAX_SELECTED_FILES]:
        if total_chars >= budget:
            break
        full = (repo_path / fpath).resolve()
        if not full.is_relative_to(repo_path.resolve()):
            continue
        if not full.is_file():
            continue
        try:
            content = full.read_text(encoding="utf-8", errors="replace")[:MAX_FILE_READ_BYTES]
            selected.append((fpath, content))
            total_chars += len(content)
        except Exception:
            pass

    return selected


def _build_smart_context(
    issue_title: str,
    issue_body: str,
    issue_labels: list[str],
    issue_url: str,
    repo_url: str,
    familiarity_level: str,
    fix_intent: str,
    free_context: str | None,
    file_tree: list[str],
    selected_files: list[tuple[str, str]],
) -> str:
    """Build the structured user prompt context from issue data, tree, and selected files."""
    parts: list[str] = []

    # Section 1: Issue description
    parts.append(f"Issue Title: {issue_title}")
    if issue_labels:
        parts.append(f"Issue Labels: {', '.join(issue_labels)}")
    parts.append(f"Issue URL: {issue_url}")
    body = issue_body[:MAX_ISSUE_BODY_CHARS] if issue_body else "(no description)"
    if len(issue_body) > MAX_ISSUE_BODY_CHARS:
        body += "\n\n[... issue body truncated ...]"
    parts.append(f"Issue Description:\n{body}")

    # Section 2: Metadata
    parts.append(f"\nRepository: {repo_url}")
    parts.append(f"Familiarity: {familiarity_level}")
    parts.append(f"Fix intent: {fix_intent}")
    if free_context:
        parts.append(f"Additional context:\n{free_context}")

    # Section 3: Repo file tree
    tree_str = "\n".join(file_tree)
    if len(tree_str) > 10_000:
        tree_str = tree_str[:10_000] + "\n... (tree truncated)"
    parts.append(f"\nRepository File Tree ({len(file_tree)} files):\n{tree_str}")

    # Section 4: Relevant source files
    if selected_files:
        parts.append(f"\nRelevant Source Files ({len(selected_files)} files):")
        for fpath, content in selected_files:
            parts.append(f"\n--- {fpath} ---\n{content}")
    else:
        parts.append("\nNo relevant source files selected.")

    return "\n".join(parts)


def _normalize_code(text: str) -> str:
    """Normalize code for semantic comparison: collapse whitespace, strip trailing
    commas before closing brackets, normalize spacing around delimiters."""
    s = re.sub(r"\s+", " ", text).strip()
    s = re.sub(r",\s*([)\]}>])", r"\1", s)
    s = re.sub(r"\s*([(\[{<])\s*", r"\1", s)
    s = re.sub(r"\s*([)\]}>])\s*", r"\1", s)
    return s


def _is_noop_diff(diff_text: str) -> bool:
    """Detect if a diff contains only cosmetic changes (whitespace, formatting, trailing commas).
    Returns True if every hunk's removed and added content are semantically identical."""
    lines = diff_text.splitlines()
    added: list[str] = []
    removed: list[str] = []

    for line in lines:
        if line.startswith("+") and not line.startswith("+++"):
            added.append(line[1:])
        elif line.startswith("-") and not line.startswith("---"):
            removed.append(line[1:])

    if not added and not removed:
        return True

    # Check 1: stripped lines are identical (whitespace-only change)
    stripped_removed = [l.strip() for l in removed]
    stripped_added = [l.strip() for l in added]
    if stripped_removed == stripped_added:
        return True

    # Check 2: only blank lines differ
    real_removed = [l for l in stripped_removed if l]
    real_added = [l for l in stripped_added if l]
    if real_removed == real_added:
        return True

    # Check 3: content is identical when joined and normalized
    # (catches reformatting: line splits, trailing commas, indentation changes)
    norm_removed = _normalize_code(" ".join(removed))
    norm_added = _normalize_code(" ".join(added))
    if norm_removed == norm_added:
        return True

    return False


def _detect_secrets(text: str) -> list[str]:
    """Detect potential secrets in text. Returns list of risk flag descriptions without matched content."""
    flags: list[str] = []
    for pattern in SECRET_PATTERNS:
        matches = re.findall(pattern, text)
        if matches:
            flags.append(f"Potential secret pattern matched ({len(matches)} occurrence(s))")
    return flags


def _compute_confidence(
    diff_size: int,
    test_passed: bool,
    risk_flags: list[str],
    trace_errors: bool,
    is_noop: bool = False,
) -> float:
    """
    Compute confidence score 0-100 based on diff size, tests, risks, errors.
    """
    if is_noop:
        return 5.0

    score = 70.0
    if diff_size > 0:
        score += min(15, diff_size / 10)
    if test_passed:
        score += 15.0
    if risk_flags:
        score -= len(risk_flags) * 20.0
    if trace_errors:
        score -= 25.0
    return max(0.0, min(100.0, score))


def _run_tests(repo_path: Path) -> tuple[str, bool]:
    """Run tests if available. Returns (output, passed)."""
    outputs: list[str] = []
    passed = False

    # Try common test commands
    for cmd, cwd in [
        (["npm", "test"], repo_path),
        (["pnpm", "test"], repo_path),
        (["yarn", "test"], repo_path),
        (["python", "-m", "pytest", "-v", "--tb=short"], repo_path),
        (["go", "test", "./..."], repo_path),
    ]:
        try:
            result = subprocess.run(
                cmd,
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=120,
            )
            out = result.stdout + result.stderr
            outputs.append(f"$ {' '.join(cmd)}\n{out}")
            if result.returncode == 0:
                passed = True
                break
        except (subprocess.TimeoutExpired, FileNotFoundError):
            continue

    if not outputs:
        return "No supported test runner found (npm/pnpm/yarn/pytest/go).", False
    return "\n---\n".join(outputs), passed


def execute_job(
    job_id: str,
    issue_url: str,
    repo_url: str,
    familiarity_level: str,
    fix_intent: str,
    free_context: str | None,
    llm_provider: str = "anthropic",
    llm_model: str = "claude-sonnet-4-20250514",
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
) -> ArtifactPackage:
    """
    Execute a job: clone repo, analyze issue, call Claude, generate diff, run tests.
    Has a 10-minute timeout and cleans up temp directories.
    """
    trace: list[str] = []
    trace_errors = False
    work_dir: Path | None = None

    def log(msg: str) -> None:
        trace.append(msg)

    try:
        work_dir = Path(tempfile.mkdtemp(prefix="contribos-job-"))
        log(f"Created work dir: {work_dir}")

        # Clone repository
        repo_path = work_dir / "repo"
        clone_result = subprocess.run(
            ["git", "clone", "--depth", "1", repo_url, str(repo_path)],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if clone_result.returncode != 0:
            log("Clone failed")
            trace_errors = True
            return ArtifactPackage(
                diff="",
                execution_trace="\n".join(trace),
                confidence_score=0.0,
                test_results="",
                changed_files=[],
                summary="Failed to clone repository.",
                risk_flags=["clone_failed"],
            )

        log("Clone succeeded")

        labels = issue_labels or []

        # Phase 2a: Build file tree
        file_tree = _build_file_tree(repo_path)
        log(f"File tree: {len(file_tree)} files")

        # Phase 2b: Extract keywords from issue
        keywords = _extract_keywords(issue_title, issue_body, labels)
        path_mentions = _extract_path_mentions(issue_body)
        log(f"Keywords: {len(keywords)}, Path mentions: {len(path_mentions)}")

        # Phase 2c: Score and select relevant files
        scored = _score_files(file_tree, keywords, path_mentions)
        selected_files = _select_relevant_files(repo_path, scored, file_tree)
        log(f"Selected {len(selected_files)} relevant files (from {len(scored)} scored)")

        # Phase 2d: Build structured context
        context = _build_smart_context(
            issue_title=issue_title,
            issue_body=issue_body,
            issue_labels=labels,
            issue_url=issue_url,
            repo_url=repo_url,
            familiarity_level=familiarity_level,
            fix_intent=fix_intent,
            free_context=free_context,
            file_tree=file_tree,
            selected_files=selected_files,
        )
        log(f"Context built: {len(context)} chars")

        # --- A2A Agent Provider branch ---
        if agent_provider_endpoint:
            log(f"Using A2A agent provider: {agent_provider_name or agent_provider_endpoint}")

            a2a_prompt = (
                f"Fix the following GitHub issue by producing a unified diff.\n\n"
                f"{context}\n\n"
                f"Output ONLY a valid unified diff in `git diff` format. "
                f"Start each file section with: diff --git a/<path> b/<path>. "
                f"Use --- a/<path> and +++ b/<path> prefixes. "
                f"Use real line numbers in hunk headers. "
                f"No markdown fences, no explanations."
            )

            a2a_result = send_task_and_poll(
                endpoint=agent_provider_endpoint,
                prompt=a2a_prompt,
                api_key=agent_provider_api_key,
                auth_scheme=agent_provider_auth_scheme,
            )

            log(f"A2A task {a2a_result.task_id}: state={a2a_result.state}, latency={a2a_result.latency_s:.1f}s")

            if a2a_result.state != "completed" or not a2a_result.diff_text:
                error_msg = a2a_result.error_message or "Agent did not produce a parseable diff"
                log(f"A2A task failed: {error_msg}")
                return ArtifactPackage(
                    diff="",
                    execution_trace="\n".join(trace),
                    confidence_score=0.0,
                    test_results="",
                    changed_files=[],
                    summary=f"A2A agent failed: {error_msg[:300]}",
                    risk_flags=["agent_execution_error", error_msg[:200]],
                )

            diff_text = a2a_result.diff_text
            risk_flags = _detect_secrets(diff_text)

            changed_files: list[str] = []
            for line in diff_text.splitlines():
                if line.startswith("--- ") or line.startswith("+++ "):
                    part = line[4:].strip()
                    if part.startswith("a/") or part.startswith("b/"):
                        part = part[2:]
                    if part and part != "/dev/null" and part not in changed_files:
                        changed_files.append(part)

            noop = _is_noop_diff(diff_text)
            diff_lines = len([l for l in diff_text.splitlines() if l.strip()])
            confidence = _compute_confidence(
                diff_size=diff_lines,
                test_passed=False,
                risk_flags=risk_flags,
                trace_errors=False,
                is_noop=noop,
            )

            summary = (
                f"A2A agent generated diff with {diff_lines} lines across {len(changed_files)} file(s). "
                f"Agent: {agent_provider_name or 'unknown'}, latency: {a2a_result.latency_s:.1f}s."
            )

            return ArtifactPackage(
                diff=diff_text,
                execution_trace="\n".join(trace),
                confidence_score=round(confidence, 1),
                test_results="Tests not run (A2A agent mode).",
                changed_files=changed_files,
                summary=summary,
                risk_flags=risk_flags,
            )

        # --- Custom BYOK Provider branch ---
        if custom_provider_base_url and custom_provider_api_key:
            effective_model = custom_provider_model or llm_model
            adapter = CustomProviderAdapter(
                base_url=custom_provider_base_url,
                api_key=custom_provider_api_key,
                model_id=effective_model,
            )
            llm_model = effective_model
            llm_provider = "custom"
            log(f"Using custom BYOK provider: {custom_provider_base_url}")
        else:
            try:
                adapter = get_adapter(llm_provider)
            except ValueError:
                log(f"No adapter for provider '{llm_provider}'; falling back to anthropic")
                adapter = get_adapter("anthropic")

        if not adapter.is_available():
            log(f"Provider '{llm_provider}' not configured; skipping LLM call")
            return ArtifactPackage(
                diff="",
                execution_trace="\n".join(trace),
                confidence_score=10.0,
                test_results="",
                changed_files=[],
                summary=f"Provider '{llm_provider}' API key not configured. No fix generated.",
                risk_flags=[],
            )

        system_prompt = (
            "You are an expert open-source contributor tasked with fixing a GitHub issue. "
            "You will receive:\n"
            "1. The issue title, labels, and full description\n"
            "2. The repository file tree (all file paths)\n"
            "3. The contents of the most relevant source files\n\n"
            "Your job:\n"
            "- Understand the issue from its description, labels, and any stack traces or error messages\n"
            "- Use the file tree to understand the project structure\n"
            "- Use the provided source files to write the fix\n"
            "- Reference ONLY file paths that appear in the file tree\n"
            "- Output a valid unified diff in EXACT `git diff` format\n"
            "- REQUIRED: Start each file section with: diff --git a/<path> b/<path>\n"
            "- REQUIRED: Use --- a/<path> and +++ b/<path> prefixes (with a/ and b/)\n"
            "- REQUIRED: Use real line numbers in hunk headers: @@ -<old_start>,<old_count> +<new_start>,<new_count> @@\n"
            "- NEVER use placeholder hunk headers like @@ ... @@\n"
            "- Include 3+ context lines around each change\n"
            "- If the fix requires modifying files not provided, still produce the diff using your best understanding\n"
            "- If you cannot produce a fix, output an empty diff\n\n"
            "Example format:\n"
            "diff --git a/src/foo.py b/src/foo.py\n"
            "--- a/src/foo.py\n"
            "+++ b/src/foo.py\n"
            "@@ -10,7 +10,8 @@\n"
            " context line\n"
            "-old line\n"
            "+new line\n"
            " context line\n\n"
            "Output ONLY the unified diff. No markdown fences, no explanations, no commentary."
        )
        user_prompt = (
            f"Fix the following issue by producing a unified diff.\n\n"
            f"{context}\n\n"
            f"Output ONLY the unified diff."
        )

        result = adapter.complete(
            model=llm_model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_tokens=4096,
        )
        diff_text = result.text

        log(f"LLM response received (provider={llm_provider}, model={llm_model})")

        # Detect secrets in generated diff
        risk_flags = _detect_secrets(diff_text)

        # Apply diff to repo (or simulate) to get changed files
        changed_files: list[str] = []
        if diff_text.strip():
            try:
                # Extract file paths from diff headers (e.g. "--- a/path" or "+++ b/path")
                for line in diff_text.splitlines():
                    if line.startswith("--- ") or line.startswith("+++ "):
                        part = line[4:].strip()
                        if part.startswith("a/") or part.startswith("b/"):
                            part = part[2:]
                        if part and part != "/dev/null" and part not in changed_files:
                            changed_files.append(part)
            except Exception:
                pass

        noop = _is_noop_diff(diff_text)
        if noop:
            log("Detected no-op diff (whitespace-only changes)")

        # Run tests
        test_output, test_passed = _run_tests(repo_path)
        log(f"Tests passed: {test_passed}")

        # Compute confidence
        diff_lines = len([l for l in diff_text.splitlines() if l.strip()])
        confidence = _compute_confidence(
            diff_size=diff_lines,
            test_passed=test_passed,
            risk_flags=risk_flags,
            trace_errors=trace_errors,
            is_noop=noop,
        )

        if noop:
            summary = "No meaningful code changes produced — diff contains only whitespace modifications."
        else:
            summary = f"Generated diff with {diff_lines} lines across {len(changed_files)} file(s). "
            if test_passed:
                summary += "Tests passed."
            else:
                summary += "Tests not run or failed."
            if risk_flags:
                summary += f" Risk flags: {len(risk_flags)}."

        return ArtifactPackage(
            diff=diff_text,
            execution_trace="\n".join(trace),
            confidence_score=round(confidence, 1),
            test_results=test_output,
            changed_files=changed_files,
            summary=summary.strip(),
            risk_flags=risk_flags,
        )

    except Exception as exc:
        import traceback as _tb
        err_type = type(exc).__name__
        err_detail = str(exc)[:500]
        tb_lines = _tb.format_exc(limit=3)[-800:]
        trace.append(f"Error ({err_type}): {err_detail}")
        trace.append(f"Traceback:\n{tb_lines}")
        trace_errors = True

        is_auth = any(k in err_detail.lower() for k in ("401", "unauthorized", "invalid api key", "authentication", "invalid_api_key"))
        is_key_missing = "not configured" in err_detail.lower()
        if is_auth or is_key_missing:
            summary = f"LLM API call failed: {err_type} — {err_detail[:200]}"
        else:
            summary = f"Execution failed: {err_type} — {err_detail[:200]}"

        return ArtifactPackage(
            diff="",
            execution_trace="\n".join(trace),
            confidence_score=0.0,
            test_results="",
            changed_files=[],
            summary=summary,
            risk_flags=["execution_error", f"{err_type}: {err_detail[:200]}"],
        )

    finally:
        if work_dir and work_dir.exists():
            try:
                shutil.rmtree(work_dir, ignore_errors=True)
            except Exception:
                pass
