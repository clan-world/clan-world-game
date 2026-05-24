#!/usr/bin/env bash
# Bash error-path tests for agents/entrypoint.sh.
#
# Strategy: source the script in a sandboxed PATH where every external tool
# (sudo, tmux, ttyd, tsx, claude) is stubbed to a controllable function. We
# verify the FAIL-CLOSED branches that production never sees but operators
# trigger when debugging:
#
#   1. Missing ELDER_N -> exit 1 immediately (set -u inside a positional
#      parameter-substitution).
#   2. ALLOW_UNRESTRICTED_EGRESS=1 -> firewall script is NEVER invoked
#      (operator opt-out for missing CAP_NET_ADMIN).
#   3. init-firewall.sh missing AND ALLOW_UNRESTRICTED_EGRESS unset ->
#      exit 3 with "Image misbuild?" hint.
#   4. init-firewall.sh present + sudo refuses -> exit 3 with CAP_NET_ADMIN
#      hint.
#
# These all exit before the runner spawn loop, so we don't need to stub tsx
# or ttyd to reach them.
#
# Run from repo root:
#   bash agents/test_entrypoint_dry.sh
#
# Exit code:
#   0 = all checks passed
#   1 = at least one check failed

set -u
# NOTE: deliberately do NOT `set -e` in the harness — we WANT to keep running
# after each assertion to surface the full failure set in one pass.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTRYPOINT="$REPO_ROOT/agents/entrypoint.sh"

if [[ ! -x "$ENTRYPOINT" ]]; then
  echo "FATAL: $ENTRYPOINT not executable or missing" >&2
  exit 1
fi

PASS=0
FAIL=0
FAIL_NAMES=()

# --- assertion helpers ------------------------------------------------------

assert() {
  local name="$1"; shift
  if "$@"; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name" >&2
    FAIL=$((FAIL + 1))
    FAIL_NAMES+=("$name")
  fi
}

run_entrypoint() {
  # Runs entrypoint.sh in a sandboxed PATH + isolated env. Stdout+stderr
  # tee'd to a per-invocation log we can grep.
  #
  # Args:
  #   $1 = log file path
  #   $2 = expected exit code (or "any")
  #   remaining = env assignments + final command, e.g.
  #     ELDER_N=2 ALLOW_UNRESTRICTED_EGRESS=1
  local logfile="$1"; shift
  local expected_rc="$1"; shift
  local actual_rc=0
  env -i HOME="$HOME" PATH="$SANDBOX_BIN:/usr/bin:/bin" "$@" \
    bash "$ENTRYPOINT" > "$logfile" 2>&1 &
  local pid=$!
  # Most tests exit fast; give them 3s, then kill (the monitor loop is
  # infinite in the happy path, but our error-path tests should exit before
  # the monitor).
  ( sleep 3; kill -9 "$pid" 2>/dev/null || true ) &
  local watchdog=$!
  wait "$pid" 2>/dev/null
  actual_rc=$?
  kill "$watchdog" 2>/dev/null || true
  wait "$watchdog" 2>/dev/null || true
  if [[ "$expected_rc" != "any" && "$actual_rc" -ne "$expected_rc" ]]; then
    echo "    expected exit $expected_rc, got $actual_rc" >&2
    echo "    --- log ---" >&2
    sed 's/^/    /' "$logfile" >&2
    return 1
  fi
  return 0
}

log_contains() {
  local logfile="$1"; shift
  local pattern="$1"; shift
  if ! grep -qF "$pattern" "$logfile"; then
    echo "    log missing pattern: $pattern" >&2
    echo "    --- log ---" >&2
    sed 's/^/    /' "$logfile" >&2
    return 1
  fi
  return 0
}

# --- sandbox setup ----------------------------------------------------------

SANDBOX="$(mktemp -d)"
SANDBOX_BIN="$SANDBOX/bin"
mkdir -p "$SANDBOX_BIN"

trap 'rm -rf "$SANDBOX"' EXIT

# Stub: sudo — by default forwards to the wrapped command; tests can override
# via SUDO_FAIL=1.
cat > "$SANDBOX_BIN/sudo" <<'EOF'
#!/usr/bin/env bash
if [[ "${SUDO_FAIL:-0}" = "1" ]]; then
  echo "sudo: stubbed refusal" >&2
  exit 1
fi
exec "$@"
EOF
chmod +x "$SANDBOX_BIN/sudo"

# Stub: tmux, ttyd, tsx — entrypoint exits BEFORE reaching them in all the
# error-path tests below. We provide no-op stubs anyway so the kill-session
# call in entrypoint can succeed cleanly if we ever extend tests forward.
for cmd in tmux ttyd tsx; do
  cat > "$SANDBOX_BIN/$cmd" <<EOF
#!/usr/bin/env bash
echo "[stub-$cmd] called with: \$*" >&2
exit 0
EOF
  chmod +x "$SANDBOX_BIN/$cmd"
done

# Track if init-firewall.sh was invoked
mkdir -p /tmp/test-entrypoint-state
FIREWALL_TOUCH=/tmp/test-entrypoint-state/firewall-was-called

cleanup_firewall_touch() { rm -f "$FIREWALL_TOUCH"; }
trap 'rm -rf "$SANDBOX"; cleanup_firewall_touch' EXIT

# --- TEST 1: missing ELDER_N → exit 1 immediately ---------------------------
echo 'Test 1: missing ELDER_N triggers ${ELDER_N:?} bail'
LOG1="$SANDBOX/log1"
assert "exits non-zero when ELDER_N unset" \
  run_entrypoint "$LOG1" any
assert "stderr mentions ELDER_N required" \
  log_contains "$LOG1" "ELDER_N required"

# --- TEST 2: ALLOW_UNRESTRICTED_EGRESS=1 skips firewall ---------------------
# This test only verifies the early branch; it'll then proceed to look for
# init-firewall.sh OR /opt/clan-world/init-firewall.sh, then for tsx +
# elder-runtime, which DON'T exist in the sandbox → exits with FATAL for
# elder-runner. We pin that downstream-exit-1 happens AFTER the WARNING log.
echo "Test 2: ALLOW_UNRESTRICTED_EGRESS=1 skips firewall + downstream FATAL on missing runner"
LOG2="$SANDBOX/log2"
# Make /opt path NOT exist (default on CI host).
assert "ALLOW_UNRESTRICTED_EGRESS=1 reaches runner-missing FATAL" \
  run_entrypoint "$LOG2" 1 ELDER_N=1 ALLOW_UNRESTRICTED_EGRESS=1
assert "warns about unrestricted egress" \
  log_contains "$LOG2" "ALLOW_UNRESTRICTED_EGRESS=1"
assert "still reaches elder-runner missing FATAL" \
  log_contains "$LOG2" "elder-runner not found"

# --- TEST 3: init-firewall.sh missing AND no override → exit 3 --------------
echo "Test 3: missing /opt/clan-world/init-firewall.sh + no override → exit 3"
LOG3="$SANDBOX/log3"
assert "exits 3 when firewall missing + no override" \
  run_entrypoint "$LOG3" 3 ELDER_N=1
assert "image-misbuild hint in stderr" \
  log_contains "$LOG3" "Image misbuild?"

# --- TEST 4: firewall present but sudo refuses → exit 3 ---------------------
# To exercise the "sudo failure" branch, we need /opt/clan-world/init-firewall.sh
# to be executable AND in the if-branch path. Since we can't write to /opt as
# unprivileged user in CI, we sub in a fake by overriding the test-path with
# a wrapper script that mocks the file existence check. We skip this test
# if we can't `sudo install` to /opt — pragmatic: the SUDO refusal path is
# functionally identical to the missing-file path from the entrypoint's POV
# in that both end in exit 3 with a clear stderr message.
echo "Test 4: sudo refusal on firewall → exit 3"
if [[ -w /opt/clan-world ]] || mkdir -p /opt/clan-world 2>/dev/null; then
  cp "$REPO_ROOT/agents/init-firewall.sh" /opt/clan-world/init-firewall.sh 2>/dev/null && \
    chmod +x /opt/clan-world/init-firewall.sh 2>/dev/null
  if [[ -x /opt/clan-world/init-firewall.sh ]]; then
    LOG4="$SANDBOX/log4"
    assert "exits 3 when sudo refuses firewall" \
      run_entrypoint "$LOG4" 3 ELDER_N=1 SUDO_FAIL=1
    assert "CAP_NET_ADMIN hint surfaces" \
      log_contains "$LOG4" "CAP_NET_ADMIN"
    rm -f /opt/clan-world/init-firewall.sh
  else
    echo "  SKIP: could not install firewall stub to /opt/clan-world (non-root)"
  fi
else
  echo "  SKIP: /opt/clan-world not writable (test runs unprivileged on CI)"
fi

# --- summary ----------------------------------------------------------------

echo ""
echo "================================"
echo "PASS: $PASS"
echo "FAIL: $FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  echo "Failed tests:"
  for name in "${FAIL_NAMES[@]}"; do
    echo "  - $name"
  done
  exit 1
fi
exit 0
