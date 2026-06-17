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
  # INIT_FIREWALL_SCRIPT points at a SANDBOX path (never the real /opt) so the
  # test can never clobber the production firewall script even when run as root.
  # Tests that want the "firewall present" branch create that file first; the
  # rest get the "missing → exit 3" branch because it doesn't exist yet.
  env -i HOME="$HOME" PATH="$SANDBOX_BIN:/usr/bin:/bin" \
    INIT_FIREWALL_SCRIPT="$FAKE_FIREWALL" "$@" \
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

# Install a fake init-firewall.sh into the SANDBOX /opt stand-in. When invoked
# it touches $FIREWALL_TOUCH so tests can prove whether the entrypoint actually
# ran it. Honours SUDO_FAIL via the sudo stub (the script itself always exits 0;
# the sudo wrapper decides success/failure).
install_fake_firewall() {
  cat > "$FAKE_FIREWALL" <<EOF
#!/usr/bin/env bash
touch "$FIREWALL_TOUCH"
echo "[stub-firewall] init-firewall.sh invoked" >&2
exit 0
EOF
  chmod +x "$FAKE_FIREWALL"
}

firewall_was_invoked() { [[ -e "$FIREWALL_TOUCH" ]]; }
firewall_not_invoked() { [[ ! -e "$FIREWALL_TOUCH" ]]; }

# --- sandbox setup ----------------------------------------------------------

SANDBOX="$(mktemp -d)"
SANDBOX_BIN="$SANDBOX/bin"
mkdir -p "$SANDBOX_BIN"

# Sandbox stand-in for /opt/clan-world/init-firewall.sh. The entrypoint reads
# its firewall path from INIT_FIREWALL_SCRIPT (defaults to the real /opt path in
# production); we point it HERE so no test ever writes to or removes the real
# /opt — critical on a root CI host where that would clobber production.
FAKE_OPT="$SANDBOX/opt/clan-world"
FAKE_FIREWALL="$FAKE_OPT/init-firewall.sh"
mkdir -p "$FAKE_OPT"

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

# Track if init-firewall.sh was actually invoked. The fake firewall script
# (installed in Test 4) touches this sentinel when run; assertions below check
# its presence/absence to prove the firewall was / was not invoked. Kept inside
# the sandbox so EXIT cleanup removes it with the rest of the tree.
FIREWALL_TOUCH="$SANDBOX/firewall-was-called"

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
# Install the firewall stub so that IF the script were (wrongly) invoked the
# sentinel would appear — this makes the "firewall NEVER invoked" assertion
# below actually verifiable rather than vacuous.
install_fake_firewall
rm -f "$FIREWALL_TOUCH"
assert "ALLOW_UNRESTRICTED_EGRESS=1 reaches runner-missing FATAL" \
  run_entrypoint "$LOG2" 1 ELDER_N=1 ALLOW_UNRESTRICTED_EGRESS=1
assert "warns about unrestricted egress" \
  log_contains "$LOG2" "ALLOW_UNRESTRICTED_EGRESS=1"
assert "still reaches elder-runner missing FATAL" \
  log_contains "$LOG2" "elder-runner not found"
assert "firewall script NEVER invoked under egress opt-out" \
  firewall_not_invoked
# Remove the stub again so Tests 3 sees the "missing firewall" branch.
rm -f "$FAKE_FIREWALL"

# --- TEST 3: init-firewall.sh missing AND no override → exit 3 --------------
echo "Test 3: missing /opt/clan-world/init-firewall.sh + no override → exit 3"
LOG3="$SANDBOX/log3"
assert "exits 3 when firewall missing + no override" \
  run_entrypoint "$LOG3" 3 ELDER_N=1
assert "image-misbuild hint in stderr" \
  log_contains "$LOG3" "Image misbuild?"

# --- TEST 4: firewall present but sudo refuses → exit 3 ---------------------
# The firewall script lives in the SANDBOX /opt stand-in (NEVER the real /opt),
# pointed at via INIT_FIREWALL_SCRIPT. This means the test runs identically as
# root or unprivileged and can never clobber the production firewall script.
echo "Test 4: sudo refusal on firewall → exit 3 (sandboxed /opt)"
install_fake_firewall
LOG4="$SANDBOX/log4"
rm -f "$FIREWALL_TOUCH"
assert "exits 3 when sudo refuses firewall" \
  run_entrypoint "$LOG4" 3 ELDER_N=1 SUDO_FAIL=1
assert "CAP_NET_ADMIN hint surfaces" \
  log_contains "$LOG4" "CAP_NET_ADMIN"
# sudo refused → the firewall script body must NOT have run (sentinel absent).
assert "firewall body NOT executed when sudo refuses" \
  firewall_not_invoked

# --- TEST 5: firewall present + sudo succeeds → script IS invoked -----------
# Positive control for the sentinel: with sudo passing through, the entrypoint
# runs the firewall script (which touches the sentinel), then proceeds to the
# runner-missing FATAL. Proves the "NEVER invoked" assertions above are real.
echo "Test 5: firewall present + sudo passthrough → firewall invoked, then runner FATAL"
install_fake_firewall
LOG5="$SANDBOX/log5"
rm -f "$FIREWALL_TOUCH"
assert "reaches runner-missing FATAL after firewall runs" \
  run_entrypoint "$LOG5" 1 ELDER_N=1
assert "firewall body WAS executed under sudo passthrough" \
  firewall_was_invoked
rm -f "$FAKE_FIREWALL"

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
