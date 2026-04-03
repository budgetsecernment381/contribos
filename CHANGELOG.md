# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-03-24

### Added

- Core platform with issue discovery, AI fix generation, review gate, and PR submission
- Multi-LLM provider support (Anthropic, OpenAI, Google, Mistral, Groq, DeepSeek, xAI, Perplexity)
- Bring Your Own Key (BYOK) custom provider support
- Agent-to-Agent (A2A) protocol integration for external agent delegation
- GitHub OAuth 2.0 authentication with httpOnly cookie tokens
- Credit-based usage system with free, starter, and pro tiers
- Multi-tier contributor reputation system (Contribution Health Score)
- Ecosystem-aware smart issue matching and scoring
- Human-in-the-loop review gate with comprehension checks
- Admin dashboard for repository management, user oversight, and prestige tuning
- GitHub webhook pipeline for PR inbox and maintainer feedback
- SSRF protection on all external URL inputs
- AES-256-GCM encryption for stored provider credentials
- Path traversal protection in worker file operations
- Content Security Policy and security headers
- Structured logging with pino across all API modules
- GitHub Actions CI pipeline (lint, typecheck, test, build, audit)
- Database indexes for performance-critical query paths
- Docker Compose with pinned images, resource limits, and localhost-bound ports
- Comprehensive documentation (README, CONTRIBUTING, SECURITY, CHANGELOG)
