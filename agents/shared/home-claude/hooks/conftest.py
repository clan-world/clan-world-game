"""Pytest conftest for elder-container hook tests.

We test user_prompt_submit.py without the `convex` dependency installed by
inserting a stub `convex` module into sys.modules BEFORE the hook imports it.
Tests that need to assert on the import-failure path delete this stub.

The hook lazy-imports `convex` inside record_receipt(), so this stub is only
consulted when a test actually drives the mutation path.
"""

from __future__ import annotations

import sys
import types
from typing import Any
from unittest.mock import MagicMock


def _install_convex_stub() -> MagicMock:
    """Install a stub `convex` module exposing a MagicMock ConvexClient.

    Returns the MagicMock class so tests can inspect call args via
    ``convex_client_class.return_value.mutation.call_args``.
    """

    module = types.ModuleType("convex")
    client_class = MagicMock(name="ConvexClient")
    module.ConvexClient = client_class  # type: ignore[attr-defined]
    sys.modules["convex"] = module
    return client_class


def pytest_configure(config: Any) -> None:  # noqa: ARG001
    _install_convex_stub()
