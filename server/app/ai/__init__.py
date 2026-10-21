from __future__ import annotations

import os

from flask import current_app

from .base import AIError, AIProvider, Crop, RecognizedItem, Variant  # noqa: F401

_provider: AIProvider | None = None


def provider_name() -> str:
    return get_provider().name


def get_provider() -> AIProvider:
    global _provider
    if _provider is not None:
        return _provider
    choice = current_app.config.get("AI_PROVIDER", "auto")
    if choice == "auto":
        choice = "claude" if os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN") else "mock"
    if choice == "claude":
        from .claude import ClaudeProvider

        _provider = ClaudeProvider(model=current_app.config.get("ANTHROPIC_MODEL", "claude-opus-5-5"))
    else:
        from .mock import MockProvider

        _provider = MockProvider()
    return _provider


def reset_provider() -> None:
    global _provider
    _provider = None
