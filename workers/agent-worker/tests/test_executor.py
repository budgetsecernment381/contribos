"""Tests for the executor module."""

import pytest

from src.executor import _compute_confidence, _detect_secrets
from src.models import ArtifactPackage


class TestConfidenceScoring:
    """Test confidence score computation."""

    def test_base_score_with_empty_diff(self):
        score = _compute_confidence(
            diff_size=0, test_passed=False, risk_flags=[], trace_errors=False
        )
        assert 65 <= score <= 75

    def test_test_passed_boosts_score(self):
        base = _compute_confidence(10, False, [], False)
        with_tests = _compute_confidence(10, True, [], False)
        assert with_tests > base
        assert with_tests - base >= 10

    def test_risk_flags_reduce_score(self):
        base = _compute_confidence(10, False, [], False)
        with_risk = _compute_confidence(10, False, ["secret_detected"], False)
        assert with_risk < base

    def test_trace_errors_reduce_score(self):
        base = _compute_confidence(10, False, [], False)
        with_errors = _compute_confidence(10, False, [], True)
        assert with_errors < base

    def test_score_clamped_0_100(self):
        low = _compute_confidence(0, False, ["a", "b", "c", "d", "e"], True)
        assert 0 <= low <= 100
        high = _compute_confidence(100, True, [], False)
        assert 0 <= high <= 100


class TestSecretDetection:
    """Test secret detection in generated code."""

    def test_detects_api_key_pattern(self):
        text = 'api_key = "sk-12345abcdef"'
        flags = _detect_secrets(text)
        assert len(flags) >= 1

    def test_detects_password_pattern(self):
        text = 'password = "super_secret_123"'
        flags = _detect_secrets(text)
        assert len(flags) >= 1

    def test_detects_github_token(self):
        text = "token = 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'"
        flags = _detect_secrets(text)
        assert len(flags) >= 1

    def test_no_false_positive_on_empty(self):
        flags = _detect_secrets("")
        assert flags == []

    def test_no_false_positive_on_safe_code(self):
        text = "x = 1\ny = 'hello'\n# no secrets"
        flags = _detect_secrets(text)
        assert len(flags) == 0


class TestDiffGeneration:
    """Test diff extraction from executor (via ArtifactPackage)."""

    def test_artifact_package_accepts_diff(self):
        pkg = ArtifactPackage(
            diff="--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new",
            execution_trace="",
            confidence_score=50.0,
            test_results="",
            changed_files=["foo.py"],
            summary="Test",
            risk_flags=[],
        )
        assert "foo.py" in pkg.diff
        assert pkg.changed_files == ["foo.py"]

    def test_artifact_package_defaults(self):
        pkg = ArtifactPackage(
            diff="",
            execution_trace="",
            confidence_score=0.0,
            test_results="",
            changed_files=[],
            summary="",
            risk_flags=[],
        )
        assert pkg.confidence_score == 0.0
        assert pkg.changed_files == []
