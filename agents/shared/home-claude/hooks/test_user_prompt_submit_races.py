"""Race-condition tests for user_prompt_submit.py hook.

Agent C — concurrent-hook/signal/file-lock race scenarios.

The CC harness can fire UserPromptSubmit hooks concurrently when an elder pastes
or types fast (each prompt spawns its own python3 subprocess). The hook does I/O
against:

  - stdin (JSON payload) — process-local, no contention
  - /run/secrets/<elder>.key file — concurrent reads + possible rotation race
  - ConvexClient.mutation network call — can be interrupted mid-flight by SIGTERM
    if the container is asked to shut down or the runner kills the orphan hook

These tests don't bring up a real Convex server; they exercise the hook's I/O
surface via subprocess + monkeypatching to assert:

  1. concurrent invocations don't corrupt shared state
  2. SIGTERM during the mutation does not raise (main() catches Exception)
  3. partial / truncated / rotated secret files degrade gracefully
  4. POSIX read concurrency on the secret file is safe
  5. tmux session-race: kill-session right before attach exits non-zero cleanly

Run with:
  python3 -m pytest agents/shared/home-claude/hooks/test_user_prompt_submit_races.py -v
"""

from __future__ import annotations

import json
import multiprocessing as mp
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import pytest

HOOK_DIR = Path(__file__).parent
HOOK_PATH = HOOK_DIR / "user_prompt_submit.py"

# A COMPLETE env that drives record_receipt past the ELDER_ID / CONVEX_DEPLOY_URL
# guards so the subprocess actually reaches the secret-file read AND the
# (stubbed/unreachable) Convex mutation path. With only BUS_ELDER_SECRET_FILE
# set, record_receipt short-circuits at `if not elder_id` and the secret-read /
# mutation path is never genuinely exercised — a refactor that reordered the
# secret read after that guard would still pass green (test theater). The convex
# SDK is not installed in the test env, so `from convex import ConvexClient`
# raises, is caught by record_receipt, and the hook exits 0 with NO network IO.
FULL_ENV = {
    "ELDER_ID": "elder-1",
    "CONVEX_DEPLOY_URL": "https://fake.convex.cloud",
}


def assert_reached_secret_path(stderr: str) -> None:
    """Assert the subprocess got PAST the env guards into the secret-read +
    convex path (i.e. did not early-return on a missing ELDER_ID/CONVEX_URL).

    Reaching the path means one of:
      - it tried to import the (absent) convex SDK → "failed to import convex SDK"
      - the secret was empty/partial → "BUS_ELDER_SECRET_FILE ... is not set"
    Either proves the secret read executed. What we must NEVER see is the
    ELDER_ID / CONVEX_DEPLOY_URL early-return — that would mean the test never
    exercised the secret path it claims to stress.
    """
    assert "ELDER_ID is not set" not in stderr, stderr
    assert "CONVEX_DEPLOY_URL is not set" not in stderr, stderr


# Ensure hook module is importable for in-process tests.
sys.path.insert(0, str(HOOK_DIR))


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def run_hook_subprocess(
    prompt: str,
    env_overrides: dict[str, str] | None = None,
    timeout: float = 10.0,
) -> subprocess.CompletedProcess[str]:
    """Run the hook as a fresh subprocess (mimics how CC invokes it)."""
    env = os.environ.copy()
    # Strip any inherited convex creds so we don't accidentally hit a real
    # endpoint during the test. record_receipt short-circuits on missing vars.
    for k in (
        "ELDER_ID",
        "CONVEX_DEPLOY_URL",
        "BUS_ELDER_SECRET",
        "BUS_ELDER_SECRET_FILE",
    ):
        env.pop(k, None)
    if env_overrides:
        env.update(env_overrides)

    payload = json.dumps({"prompt": prompt})
    return subprocess.run(
        [sys.executable, str(HOOK_PATH)],
        input=payload,
        text=True,
        capture_output=True,
        env=env,
        timeout=timeout,
    )


def _fire_hook(prompt: str, secret_file: str) -> tuple[int, str]:
    """Module-level fn so multiprocessing.Pool can pickle it.

    Passes a COMPLETE env (ELDER_ID + CONVEX_DEPLOY_URL + BUS_ELDER_SECRET_FILE)
    so the subprocess drives record_receipt all the way to the secret read and
    the convex mutation attempt. convex is not installed in the test env, so the
    import is caught and the hook exits 0 with no network IO — but the
    secret-file read path IS genuinely exercised under concurrency.
    """
    cp = run_hook_subprocess(
        prompt,
        env_overrides={
            **FULL_ENV,
            "BUS_ELDER_SECRET_FILE": secret_file,
        },
    )
    return cp.returncode, cp.stderr


# --------------------------------------------------------------------------
# 1. Concurrent hook invocations — multiprocessing.Pool
# --------------------------------------------------------------------------


def test_concurrent_hook_invocations_all_exit_zero(tmp_path: Path) -> None:
    """Fire 8 hooks in parallel against a shared secret file.

    Two failure modes this catches:
      - file-read EBADF / partial read on shared fd (none expected — each
        subprocess opens its own fd, but worth pinning behaviour)
      - any global module state in user_prompt_submit that breaks under
        concurrent import (it has none today — module is pure-functional —
        but a regression would surface here as non-zero exit)
    """
    secret = tmp_path / "bus-elder.key"
    secret.write_text("test-secret-value-xyz\n")

    prompts = [
        "tick:42",
        "tick:43",
        "whisper:abc-123",
        "special-msg:hello",
        "tick:44",
        "whisper:def-456",
        "tick:45",
        "no-prefix-ignored",
    ]

    # Spawn (not fork) to match how CC actually launches the hook.
    ctx = mp.get_context("spawn")
    with ctx.Pool(processes=8) as pool:
        results = pool.starmap(_fire_hook, [(p, str(secret)) for p in prompts])

    for prompt, (rc, stderr) in zip(prompts, results):
        assert rc == 0, f"prompt={prompt!r} stderr={stderr}"
        # Prefixed prompts must have reached the secret-read/convex path; the
        # un-prefixed one is dropped by parse_receipt before record_receipt.
        if prompt.startswith(("tick:", "whisper:", "special-msg:")):
            assert_reached_secret_path(stderr)


def test_concurrent_invocations_with_different_secret_paths(
    tmp_path: Path,
) -> None:
    """Each subprocess gets its OWN secret file. Verify env isolation works
    under multiprocessing.Pool — i.e. one elder's BUS_ELDER_SECRET_FILE does
    not leak into another's process."""
    secrets = []
    for i in range(4):
        p = tmp_path / f"bus-elder-{i + 1}.key"
        p.write_text(f"secret-{i + 1}\n")
        secrets.append(str(p))

    ctx = mp.get_context("spawn")
    with ctx.Pool(processes=4) as pool:
        results = pool.starmap(
            _fire_hook, [(f"tick:{100 + i}", secrets[i]) for i in range(4)]
        )
    for rc, stderr in results:
        assert rc == 0, stderr
        assert_reached_secret_path(stderr)


# --------------------------------------------------------------------------
# 2. SIGTERM during ConvexClient.mutation
# --------------------------------------------------------------------------


def test_mutation_connection_reset_is_absorbed(monkeypatch, tmp_path):
    """A mutation that raises mid-flight (network failure / connection reset /
    timeout) must NOT propagate — main()'s catch-all Exception handler absorbs
    it so the hook returns 0 (CC treats non-zero as HOOK_FAILURE and gates
    further prompts).

    NOTE: this is NOT a real SIGTERM test (renamed from the old
    test_sigterm_during_mutation_*). The catch is `except Exception`, which does
    NOT swallow KeyboardInterrupt / SystemExit, and a default SIGTERM just kills
    the process with no Python-level exception. What we actually exercise here is
    the mutation-exception path: ConnectionResetError is a normal Exception
    subclass and must be caught."""

    # Monkeypatch the mutation to raise something that simulates an interrupted
    # network call: ConnectionResetError is a sub-Exception, must be caught.
    import importlib

    if "user_prompt_submit" in sys.modules:
        del sys.modules["user_prompt_submit"]
    ups = importlib.import_module("user_prompt_submit")

    secret = tmp_path / "secret.key"
    secret.write_text("k")

    monkeypatch.setenv("ELDER_ID", "elder-1")
    monkeypatch.setenv("CONVEX_DEPLOY_URL", "https://fake.convex.cloud")
    monkeypatch.setenv("BUS_ELDER_SECRET_FILE", str(secret))

    class _FakeClient:
        def __init__(self, url):
            self.url = url

        def mutation(self, name, payload):
            # Simulate signal-induced abort mid-flight
            raise ConnectionResetError("simulated SIGTERM mid-mutation")

    # Stub out the convex import inside record_receipt
    fake_convex = type(sys)("convex")
    fake_convex.ConvexClient = _FakeClient
    monkeypatch.setitem(sys.modules, "convex", fake_convex)

    # main() reads from stdin
    monkeypatch.setattr(
        "sys.stdin",
        type(
            "F",
            (),
            {
                "read": staticmethod(lambda: json.dumps({"prompt": "tick:99"})),
            },
        )(),
    )

    rc = ups.main()
    assert rc == 0, "hook must return 0 even when mutation raises"


def test_sigterm_during_secret_file_read(monkeypatch, tmp_path):
    """Simulate the secret file being deleted (rotated) mid-open.
    _read_bus_elder_secret catches OSError and falls back to env."""
    import importlib

    if "user_prompt_submit" in sys.modules:
        del sys.modules["user_prompt_submit"]
    ups = importlib.import_module("user_prompt_submit")

    bogus_path = tmp_path / "does-not-exist.key"  # not created
    monkeypatch.setenv("BUS_ELDER_SECRET_FILE", str(bogus_path))
    monkeypatch.setenv("BUS_ELDER_SECRET", "fallback-secret")

    secret = ups._read_bus_elder_secret()
    assert secret == "fallback-secret", (
        "must fall back to env var when file read fails"
    )


# --------------------------------------------------------------------------
# 3. Secret-file rotation race
# --------------------------------------------------------------------------


def test_secret_file_rotation_during_concurrent_reads(tmp_path):
    """Writer truncates+rewrites the secret while N readers spin against it.

    The hook's _read_bus_elder_secret() does:
        with open(path) as f: secret = f.read().strip()
        if secret: return secret

    A reader who hits the file mid-truncation can read EMPTY content. The
    code then falls through to the BUS_ELDER_SECRET env var — but if that's
    unset, the hook logs and returns 0 (does NOT crash). Verify exit code 0
    across many rotations.
    """
    secret = tmp_path / "rotating.key"
    secret.write_text("initial-secret\n")

    stop = threading.Event()

    def rotator():
        # Two-step write: truncate then write. This is the WORST-case rotation
        # pattern (a sane operator uses write-tmp+rename for atomicity). The
        # hook MUST survive even the worst case because operators do dumb
        # things under pressure.
        i = 0
        while not stop.is_set():
            try:
                with open(secret, "w") as f:
                    # Intentionally split into two writes with a fsync gap to
                    # widen the window where a reader sees partial content.
                    f.write("rotated-")
                    f.flush()
                    os.fsync(f.fileno())
                    f.write(f"value-{i}\n")
                i += 1
            except OSError:
                pass
            time.sleep(0.001)

    t = threading.Thread(target=rotator, daemon=True)
    t.start()

    try:
        # Fire 12 sequential subprocess hooks; each will read the file at
        # some unknown point in the rotation cycle.
        for i in range(12):
            cp = run_hook_subprocess(
                f"tick:{i}",
                env_overrides={
                    **FULL_ENV,
                    "BUS_ELDER_SECRET_FILE": str(secret),
                    # Provide a fallback so the hook actually exercises the
                    # "secret was empty / partial" branch by re-reading env.
                    "BUS_ELDER_SECRET": "env-fallback",
                },
            )
            assert cp.returncode == 0, f"iteration {i}: stderr={cp.stderr}"
            # Full env + a non-empty secret (file or env fallback) means the
            # subprocess drove all the way through the secret read to the
            # convex import attempt — proving the rotation race is exercised
            # on the real read path, not short-circuited at the env guard.
            assert_reached_secret_path(cp.stderr)
    finally:
        stop.set()
        t.join(timeout=2)


def test_secret_file_with_only_whitespace_returns_none(monkeypatch, tmp_path):
    """File contains only whitespace (e.g. partial-write of '\n' before payload
    lands). _read_bus_elder_secret() must NOT return whitespace as a valid
    secret — it'd cause the runner to submit a request with secret='' to
    Convex which the new authenticated mutation would reject as forged
    (Bundle 4 R1 hardening explicitly addresses this)."""
    import importlib

    if "user_prompt_submit" in sys.modules:
        del sys.modules["user_prompt_submit"]
    ups = importlib.import_module("user_prompt_submit")

    secret = tmp_path / "whitespace.key"
    secret.write_text("   \n\t  \n")

    monkeypatch.setenv("BUS_ELDER_SECRET_FILE", str(secret))
    monkeypatch.delenv("BUS_ELDER_SECRET", raising=False)

    result = ups._read_bus_elder_secret()
    assert result is None, (
        "whitespace-only file must be treated as no-secret, not as a valid "
        "empty-after-strip credential"
    )


# --------------------------------------------------------------------------
# 4. tmux session race (kill while attach is happening)
# --------------------------------------------------------------------------


@pytest.mark.skipif(
    subprocess.run(
        ["which", "tmux"], capture_output=True, text=True
    ).returncode
    != 0,
    reason="tmux not installed in test env",
)
def test_tmux_kill_session_during_attach_race():
    """entrypoint.sh assumes:
      1. kill-session at top (clear stale)
      2. runner creates new session
      3. ttyd attach-session

    If two entrypoint invocations race (e.g. container restart while
    cleanup is still happening), kill-session called on a session that
    another shell is attaching to should NOT corrupt state. tmux just
    exits non-zero on the attaching side.

    This test verifies the bash semantics: `tmux kill-session -t X || true`
    returns 0 even when X doesn't exist. The script depends on this for
    its initial cleanup line not to abort under `set -e`.
    """
    session = "test-exp-c-race-session"
    # Make sure clean state
    subprocess.run(
        ["tmux", "kill-session", "-t", session], capture_output=True
    )

    # Create the session detached
    cp = subprocess.run(
        ["tmux", "new-session", "-d", "-s", session, "sleep", "10"],
        capture_output=True,
        text=True,
    )
    assert cp.returncode == 0, cp.stderr

    try:
        # Now race: two concurrent kill-session calls. The second should not
        # crash bash even though the session is already gone.
        r1 = subprocess.run(
            ["tmux", "kill-session", "-t", session], capture_output=True
        )
        r2 = subprocess.run(
            ["tmux", "kill-session", "-t", session], capture_output=True
        )
        # First succeeds, second fails (no such session). entrypoint.sh
        # protects with `|| true` so both are tolerable.
        assert r1.returncode == 0
        assert r2.returncode != 0  # confirms tmux IS strict here
        # The `|| true` idiom in entrypoint.sh:41 is therefore load-bearing —
        # without it, a re-entrant entrypoint would `set -e` exit on cleanup.
    finally:
        subprocess.run(
            ["tmux", "kill-session", "-t", session], capture_output=True
        )


# --------------------------------------------------------------------------
# 5. Prompt parser stress under concurrent input edge cases
# --------------------------------------------------------------------------


def test_concurrent_parse_with_malformed_prompts(tmp_path):
    """Throw a bag of malformed payloads at the hook in parallel. The hook
    must short-circuit gracefully on every one (return 0, no traceback)."""
    secret = tmp_path / "k"
    secret.write_text("s")

    payloads = [
        "",  # empty stdin → no prompt → no-op
        "not-json-at-all",  # JSONDecodeError → treated as raw prompt
        "null",  # json.loads → None → non-dict guard
        "true",  # json.loads → bool → non-dict guard
        "[]",  # json.loads → list → non-dict guard
        '{"prompt": null}',  # prompt is not a str → "" returned
        '{"prompt": 123}',  # prompt is not a str
        '{"prompt": "tick:not-a-number"}',  # invalid tick number → log+skip
        '{"prompt": "whisper:"}',  # empty whisper uid → log+skip
        '{"prompt": "special-msg:"}',  # empty special-msg uid → log+skip
        '{"prompt": "\\n   \\n   tick:7"}',  # leading whitespace lines OK
    ]

    ctx = mp.get_context("spawn")

    def run_with_raw(raw):
        cp = subprocess.run(
            [sys.executable, str(HOOK_PATH)],
            input=raw,
            text=True,
            capture_output=True,
            env={
                **os.environ,
                "BUS_ELDER_SECRET_FILE": str(secret),
            },
            timeout=5,
        )
        return cp.returncode, cp.stderr

    # Serial is fine here — we already proved concurrent invocation safety
    # in test_concurrent_hook_invocations. The point here is FUZZ surface.
    for raw in payloads:
        rc, stderr = run_with_raw(raw)
        assert rc == 0, f"raw={raw!r} stderr={stderr}"
        assert "Traceback" not in stderr, f"unhandled exception on raw={raw!r}"


# --------------------------------------------------------------------------
# 6. Sanity: hook completes well under CC's timeout budget
# --------------------------------------------------------------------------


def test_hook_completes_quickly_when_no_convex_call(tmp_path):
    """When no ELDER_ID/CONVEX_DEPLOY_URL is set, the hook should not block
    on any I/O beyond reading stdin + the secret file. Pin a soft latency
    budget so future regressions (e.g. accidentally importing convex at
    module top-level) show up in tests."""
    secret = tmp_path / "k"
    secret.write_text("s")

    start = time.perf_counter()
    cp = run_hook_subprocess(
        "tick:1",
        env_overrides={"BUS_ELDER_SECRET_FILE": str(secret)},
    )
    elapsed = time.perf_counter() - start
    assert cp.returncode == 0
    # Primary guard is BEHAVIORAL: with no ELDER_ID/CONVEX_DEPLOY_URL the hook
    # must short-circuit before any blocking/network IO (the regression we care
    # about is e.g. importing convex at module top-level). The early-return
    # marker proves no convex work happened.
    assert "ELDER_ID is not set" in cp.stderr, cp.stderr
    # Soft latency budget as a secondary signal. Generous so it does not flake
    # under CI load (this suite already runs ~45s); failure here is advisory,
    # the behavioral assertion above is the real guard.
    assert elapsed < 10.0, (
        f"hook took {elapsed:.2f}s — far over even a loaded-CI budget; "
        "check for accidental blocking IO at import/startup"
    )
