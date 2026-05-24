"""Tests for the elder UserPromptSubmit hook.

Focus: untested ERROR PATHS (Agent A / parallel test-improvement experiment,
2026-05-24). Sibling agents B/C/D/E own boundary, race, integration, and fuzz
coverage respectively — this file deliberately avoids those segments.

Run from repo root:

    python3 -m pytest agents/shared/home-claude/hooks/test_user_prompt_submit.py -v

The `convex` SDK is stubbed in conftest.py so tests run on a host without the
Rust-backed wheel installed (CI + dev laptops).
"""

from __future__ import annotations

import importlib
import io
import json
import os
import signal
import sys
import threading
import time
from pathlib import Path
from typing import Any, Iterator
from unittest.mock import MagicMock, patch

import pytest


# --- module loading ---------------------------------------------------------

HOOKS_DIR = Path(__file__).parent
if str(HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(HOOKS_DIR))

import user_prompt_submit as hook  # noqa: E402  (sys.path manipulation above)


# --- fixtures ---------------------------------------------------------------

ELDER_ENV_VARS = ("ELDER_ID", "CONVEX_DEPLOY_URL", "BUS_ELDER_SECRET",
                  "BUS_ELDER_SECRET_FILE")


@pytest.fixture(autouse=True)
def _isolate_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Strip any inherited elder env vars so tests get a clean slate."""
    for key in ELDER_ENV_VARS:
        monkeypatch.delenv(key, raising=False)
    yield


class _StderrProxy:
    """Adapter to keep the stderr_capture name + .getvalue() shape while
    delegating to pytest's capsys (which is the only thing that reliably
    captures stderr written by ``print(..., file=sys.stderr)``).
    """

    def __init__(self, capsys: pytest.CaptureFixture[str]) -> None:
        self._capsys = capsys
        self._accum = ""

    def getvalue(self) -> str:
        # readouterr() resets the buffer — accumulate so multiple reads
        # within a single test return everything written so far.
        captured = self._capsys.readouterr()
        self._accum += captured.err
        return self._accum


@pytest.fixture
def stderr_capture(capsys: pytest.CaptureFixture[str]) -> _StderrProxy:
    return _StderrProxy(capsys)


def _set_full_env(monkeypatch: pytest.MonkeyPatch, secret_path: str | None = None) -> None:
    monkeypatch.setenv("ELDER_ID", "elder-2")
    monkeypatch.setenv("CONVEX_DEPLOY_URL", "https://example.convex.cloud")
    if secret_path:
        monkeypatch.setenv("BUS_ELDER_SECRET_FILE", secret_path)


# --- ERROR PATH: secret file unreadable / missing / empty -------------------

class TestSecretReadFailureModes:
    """_read_bus_elder_secret() failure paths.

    Sibling tests in pr576 cover the happy path. We exercise the fall-through
    cases that determine whether record_receipt() will skip-with-log vs error.
    """

    def test_secret_file_missing_path_falls_through_to_raw_env(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("BUS_ELDER_SECRET_FILE", "/nonexistent/path/bus.key")
        monkeypatch.setenv("BUS_ELDER_SECRET", "raw-env-fallback")
        assert hook._read_bus_elder_secret() == "raw-env-fallback"

    def test_secret_file_empty_falls_through_to_raw_env(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """Empty BUS_ELDER_SECRET_FILE must NOT shadow a present BUS_ELDER_SECRET.

        Regression guard for the documented "stale raw env shadowing real secret"
        risk — but in reverse: an empty file (0-byte mount, or `:>file` race)
        should not block fall-through.
        """
        empty = tmp_path / "empty-bus.key"
        empty.write_text("")
        monkeypatch.setenv("BUS_ELDER_SECRET_FILE", str(empty))
        monkeypatch.setenv("BUS_ELDER_SECRET", "raw-fallback")
        assert hook._read_bus_elder_secret() == "raw-fallback"

    def test_secret_file_unreadable_falls_through_to_raw_env(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
        stderr_capture: _StderrProxy,
    ) -> None:
        """0600-as-other-uid OR EPERM directory: ensure we log + fall through.

        We simulate via chmod 0000 on the file; root would still read but the
        test runs as non-root in CI / dev.
        """
        if os.geteuid() == 0:
            pytest.skip("running as root — chmod 0000 still readable")
        f = tmp_path / "locked-bus.key"
        f.write_text("filesecret")
        f.chmod(0)
        try:
            monkeypatch.setenv("BUS_ELDER_SECRET_FILE", str(f))
            monkeypatch.setenv("BUS_ELDER_SECRET", "env-fallback")
            assert hook._read_bus_elder_secret() == "env-fallback"
            assert "failed to read BUS_ELDER_SECRET_FILE" in stderr_capture.getvalue()
        finally:
            f.chmod(0o600)  # let pytest tmp_path cleanup work

    def test_secret_file_whitespace_only_falls_through(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """Mount with a trailing newline only ('\\n' or '  \\n') is empty after strip()."""
        ws = tmp_path / "whitespace.key"
        ws.write_text("   \n\t\n")
        monkeypatch.setenv("BUS_ELDER_SECRET_FILE", str(ws))
        monkeypatch.setenv("BUS_ELDER_SECRET", "fallback-secret")
        assert hook._read_bus_elder_secret() == "fallback-secret"

    def test_neither_env_set_returns_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # both already cleared by _isolate_env
        assert hook._read_bus_elder_secret() is None


# --- ERROR PATH: record_receipt skip conditions -----------------------------

class TestRecordReceiptSkipPaths:
    """record_receipt() must return cleanly (no exception, no mutation) when
    any of the three required pieces of state is missing. Each missing-state
    case logs a distinct message — preserving those is part of the contract
    with the runner's resend cap (see hook comment).
    """

    def test_missing_elder_id_skips(
        self, monkeypatch: pytest.MonkeyPatch, stderr_capture: _StderrProxy
    ) -> None:
        monkeypatch.setenv("CONVEX_DEPLOY_URL", "https://x.convex.cloud")
        monkeypatch.setenv("BUS_ELDER_SECRET", "secret")
        hook.record_receipt({"prefix": "tick", "tickNumber": 7})
        assert "ELDER_ID is not set" in stderr_capture.getvalue()

    def test_missing_convex_url_skips(
        self, monkeypatch: pytest.MonkeyPatch, stderr_capture: _StderrProxy
    ) -> None:
        monkeypatch.setenv("ELDER_ID", "elder-1")
        monkeypatch.setenv("BUS_ELDER_SECRET", "secret")
        hook.record_receipt({"prefix": "tick", "tickNumber": 7})
        assert "CONVEX_DEPLOY_URL is not set" in stderr_capture.getvalue()

    def test_missing_secret_skips_with_runner_resend_hint(
        self, monkeypatch: pytest.MonkeyPatch, stderr_capture: _StderrProxy
    ) -> None:
        monkeypatch.setenv("ELDER_ID", "elder-1")
        monkeypatch.setenv("CONVEX_DEPLOY_URL", "https://x.convex.cloud")
        hook.record_receipt({"prefix": "tick", "tickNumber": 7})
        log = stderr_capture.getvalue()
        assert "BUS_ELDER_SECRET" in log
        # The "resend cap will eventually surface a HOOK_FAILURE" hint is a
        # load-bearing piece of operator UX — assert it survives refactors.
        assert "resend cap" in log


# --- ERROR PATH: convex import failure --------------------------------------

class TestConvexImportFailure:
    """The hook lazy-imports `convex`. If the wheel is missing (e.g. python3
    sysroot mismatch inside a half-baked container image), we must log and
    return — never raise out of the hook (which would surface in CC as a
    hook-failure and block the prompt).
    """

    def test_missing_convex_module_logs_and_returns(
        self, monkeypatch: pytest.MonkeyPatch, stderr_capture: _StderrProxy
    ) -> None:
        _set_full_env(monkeypatch)
        monkeypatch.setenv("BUS_ELDER_SECRET", "secret")
        # Force ImportError on the lazy import.
        saved = sys.modules.pop("convex", None)
        try:
            with patch.dict(sys.modules, {"convex": None}):
                hook.record_receipt({"prefix": "tick", "tickNumber": 7})
                assert "failed to import convex SDK" in stderr_capture.getvalue()
        finally:
            if saved is not None:
                sys.modules["convex"] = saved

    def test_convex_mutation_exception_is_swallowed_by_main(
        self, monkeypatch: pytest.MonkeyPatch, stderr_capture: _StderrProxy
    ) -> None:
        """main() wraps everything in try/except — a Convex RPC raising mid-flight
        (network blip, 401, timeout) must NOT exit non-zero. The hook ALWAYS
        returns 0; surfacing an error to CC would block the elder prompt.
        """
        _set_full_env(monkeypatch)
        monkeypatch.setenv("BUS_ELDER_SECRET", "secret")
        # Re-stub convex with a client whose .mutation raises.
        bad_module = type(sys)("convex")
        bad_client = MagicMock()
        bad_client.return_value.mutation.side_effect = RuntimeError("convex 503")
        bad_module.ConvexClient = bad_client  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "convex", bad_module)

        # Feed a valid tick prompt via stdin.
        monkeypatch.setattr("sys.stdin", io.StringIO(
            json.dumps({"prompt": "tick:42\nbody"})
        ))
        rc = hook.main()
        assert rc == 0
        assert "non-fatal hook error" in stderr_capture.getvalue()


# --- ERROR PATH: malformed prompt input -------------------------------------

class TestMalformedPromptInput:
    """read_prompt() + parse_receipt() input-validation paths.

    The hook accepts (a) raw stdin text, (b) JSON-encoded {"prompt": "..."}.
    Anything else should resolve to empty string -> parse returns None ->
    record_receipt is never invoked.
    """

    def test_empty_stdin(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("sys.stdin", io.StringIO(""))
        assert hook.read_prompt() == ""

    def test_json_list_payload_resolves_to_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """isinstance(payload, dict) guard prevents AttributeError on .get()
        when CC ever ships a different envelope.
        """
        monkeypatch.setattr("sys.stdin", io.StringIO("[1, 2, 3]"))
        assert hook.read_prompt() == ""

    def test_json_with_non_string_prompt_resolves_to_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "sys.stdin", io.StringIO(json.dumps({"prompt": {"nested": "bad"}}))
        )
        assert hook.read_prompt() == ""

    def test_raw_text_passthrough_when_not_json(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("sys.stdin", io.StringIO("tick:5\nbody"))
        assert hook.read_prompt() == "tick:5\nbody"

    def test_tick_with_garbage_int_is_dropped(
        self, stderr_capture: _StderrProxy
    ) -> None:
        assert hook.parse_receipt("tick:abc\nbody") is None
        assert "invalid tick number" in stderr_capture.getvalue()

    def test_tick_with_negative_int_is_accepted(self) -> None:
        """int(., 10) accepts negative — we deliberately don't filter here so
        bug-driven negative ticks surface in the receive log for forensics
        instead of being silently swallowed by the hook.
        """
        receipt = hook.parse_receipt("tick:-5")
        assert receipt is not None
        assert receipt["tickNumber"] == -5

    def test_whisper_empty_uid_dropped(self, stderr_capture: _StderrProxy) -> None:
        assert hook.parse_receipt("whisper: \nbody") is None
        assert "empty uid" in stderr_capture.getvalue()

    def test_special_msg_empty_uid_dropped(self, stderr_capture: _StderrProxy) -> None:
        assert hook.parse_receipt("special-msg:\nbody") is None
        assert "empty uid" in stderr_capture.getvalue()

    def test_unknown_prefix_returns_none_silently(
        self, stderr_capture: _StderrProxy
    ) -> None:
        assert hook.parse_receipt("hello world") is None
        # No log should fire — non-prefixed prompts are normal operator chat.
        assert stderr_capture.getvalue() == ""


# --- ERROR PATH: signal-interrupt during mutation ---------------------------

class TestSignalInterruptDuringMutation:
    """If a SIGTERM arrives mid-mutation (e.g. container shutdown, OOM), the
    KeyboardInterrupt-style exception must be caught by main()'s try/except,
    NOT propagate. The hook returns 0 and the prompt is allowed to proceed —
    the runner's resend logic re-delivers if the receipt was lost.
    """

    def test_keyboard_interrupt_in_mutation_does_not_propagate(
        self, monkeypatch: pytest.MonkeyPatch, stderr_capture: _StderrProxy
    ) -> None:
        _set_full_env(monkeypatch)
        monkeypatch.setenv("BUS_ELDER_SECRET", "secret")
        mod = type(sys)("convex")
        client = MagicMock()
        client.return_value.mutation.side_effect = KeyboardInterrupt()
        mod.ConvexClient = client  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "convex", mod)

        monkeypatch.setattr(
            "sys.stdin", io.StringIO(json.dumps({"prompt": "tick:1"}))
        )
        # KeyboardInterrupt is BaseException, not Exception. main()'s
        # `except Exception` will NOT catch it — pre-existing behavior. We
        # encode the actual contract: signal during mutation propagates as
        # KeyboardInterrupt. The CC harness handles BaseException by surfacing
        # a hook failure. This test PINS that contract so a future "catch
        # BaseException" refactor needs a deliberate ADR.
        with pytest.raises(KeyboardInterrupt):
            hook.main()

    def test_sigalrm_interrupt_during_secret_read_swallowed_by_oserror_catch(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
        stderr_capture: _StderrProxy,
    ) -> None:
        """FINDING (test-exp-A): _read_bus_elder_secret catches OSError, and
        InterruptedError is a SUBCLASS of OSError. So a signal that interrupts
        open() during the secret read is silently swallowed — the hook logs
        "failed to read BUS_ELDER_SECRET_FILE" and falls through to the env
        var. This MAY be desired (signal during shutdown should not crash the
        hook), but it also means the secret-file failure mode and the
        signal-during-read failure mode are indistinguishable in logs.

        This test pins the CURRENT behavior so any future change to that
        exception class needs to be deliberate.
        """
        if not hasattr(signal, "SIGALRM"):
            pytest.skip("SIGALRM not available")

        f = tmp_path / "bus.key"
        f.write_text("ok")
        monkeypatch.setenv("BUS_ELDER_SECRET_FILE", str(f))
        monkeypatch.setenv("BUS_ELDER_SECRET", "env-fallback")

        def handler(signum: int, frame: Any) -> None:  # noqa: ARG001
            raise InterruptedError("signal during read")

        old = signal.signal(signal.SIGALRM, handler)
        try:
            real_open = open

            def slow_open(*args: Any, **kwargs: Any) -> Any:
                time.sleep(0.05)
                return real_open(*args, **kwargs)

            with patch("builtins.open", slow_open):
                signal.setitimer(signal.ITIMER_REAL, 0.01)
                # InterruptedError is OSError subclass → caught → log + fall
                # through. Returned value is the env fallback, NOT None.
                result = hook._read_bus_elder_secret()
                assert result == "env-fallback"
                assert "failed to read BUS_ELDER_SECRET_FILE" in stderr_capture.getvalue()
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, old)


# --- HAPPY PATH: end-to-end mutation call args ------------------------------

class TestMutationPayloadShape:
    """Lightweight happy-path so the test file isn't pure-negative. Pins the
    mutation call shape, which downstream Convex args validation depends on.
    """

    def test_tick_receipt_dispatches_correct_payload(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        f = tmp_path / "bus.key"
        f.write_text("shh-secret\n")
        _set_full_env(monkeypatch, secret_path=str(f))

        mod = type(sys)("convex")
        client = MagicMock()
        mod.ConvexClient = client  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "convex", mod)

        monkeypatch.setattr(
            "sys.stdin",
            io.StringIO(json.dumps({"prompt": "tick:42\n\nactivity body"})),
        )

        rc = hook.main()
        assert rc == 0

        client.assert_called_once_with("https://example.convex.cloud")
        client.return_value.mutation.assert_called_once()
        name, payload = client.return_value.mutation.call_args.args
        assert name == hook.MUTATION_NAME
        assert payload["secret"] == "shh-secret"  # strip() applied
        assert payload["elderId"] == "elder-2"
        assert payload["prefix"] == "tick"
        assert payload["tickNumber"] == 42
        # messagePreview joins newlines into spaces, capped at 100 chars.
        assert "\n" not in payload["messagePreview"]
        assert len(payload["messagePreview"]) <= 100
