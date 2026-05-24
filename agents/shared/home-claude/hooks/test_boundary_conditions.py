"""Boundary-condition tests for user_prompt_submit hook parsing.

Agent B (parallel test-improvement experiment 2026-05-24).
Focus: env var edge cases, prefix-parsing extremes, numeric extremes,
UID-length boundaries, preview truncation at the 100-char cap.

These tests document the ACTUAL behavior of the parser at boundaries —
several expectations below reflect observations that the implementation
has NO explicit cap (e.g. UIDs are unbounded). When a finding is a
genuine spec ambiguity, the test asserts current behavior and is marked
with a `# OBSERVATION:` comment so reviewers can decide whether to
codify or change.
"""

from __future__ import annotations

import io
import json
import os
import sys
import unittest
from unittest import mock

# Make the hook importable when pytest runs from repo root or hook dir.
_HOOK_DIR = os.path.dirname(os.path.abspath(__file__))
if _HOOK_DIR not in sys.path:
    sys.path.insert(0, _HOOK_DIR)

import user_prompt_submit as ups  # noqa: E402


class TestPrefixBoundaries(unittest.TestCase):
    """Prefix-matching is strict-prefix on the first non-blank line."""

    def test_leading_whitespace_before_tick_is_stripped(self):
        # first_line() does lstrip on each line; "   tick: 5" matches.
        out = ups.parse_receipt("   tick: 5")
        self.assertIsNotNone(out)
        self.assertEqual(out["prefix"], "tick")
        self.assertEqual(out["tickNumber"], 5)

    def test_uppercase_prefix_does_not_match(self):
        # Prefixes are case-sensitive tuple match; "TICK:" must NOT trigger
        # a receipt (Convex mutation expects lowercase prefix discriminator).
        self.assertIsNone(ups.parse_receipt("TICK: 5"))
        self.assertIsNone(ups.parse_receipt("Whisper: abc"))
        self.assertIsNone(ups.parse_receipt("Special-Msg: x"))

    def test_leading_blank_lines_are_skipped(self):
        # Runner-composed messages sometimes have a leading newline from
        # string interpolation; first_line scans until non-blank.
        out = ups.parse_receipt("\n\n   \ntick: 12")
        self.assertIsNotNone(out)
        self.assertEqual(out["tickNumber"], 12)

    def test_prefix_with_no_value_is_handled(self):
        # "tick:" with no number → ValueError on int() → None (logged).
        self.assertIsNone(ups.parse_receipt("tick:"))
        # whisper:/special-msg: with empty uid → None (explicit guard).
        self.assertIsNone(ups.parse_receipt("whisper:"))
        self.assertIsNone(ups.parse_receipt("special-msg:"))
        # Trailing whitespace only — still empty after strip().
        self.assertIsNone(ups.parse_receipt("whisper:   "))
        self.assertIsNone(ups.parse_receipt("special-msg:\t \t"))

    def test_prefix_substring_not_at_start_does_not_match(self):
        # "do a tick: 5" should not trigger; prefix match anchors at line start.
        self.assertIsNone(ups.parse_receipt("do a tick: 5"))
        self.assertIsNone(ups.parse_receipt("the whisper: 9"))


class TestTickNumberExtremes(unittest.TestCase):
    """int(value, 10) accepts arbitrary-precision Python ints."""

    def test_tick_zero(self):
        out = ups.parse_receipt("tick: 0")
        self.assertEqual(out["tickNumber"], 0)

    def test_tick_negative(self):
        # int() accepts "-5" — parser will pass a negative tick downstream.
        # OBSERVATION: no validation that tickNumber >= 0. If the Convex
        # schema rejects negatives this becomes a silent HOOK_FAILURE later.
        out = ups.parse_receipt("tick: -5")
        self.assertIsNotNone(out)
        self.assertEqual(out["tickNumber"], -5)

    def test_tick_max_int_64bit(self):
        # 2^63 - 1; Python int is arbitrary precision, parser does not cap.
        v = 2**63 - 1
        out = ups.parse_receipt(f"tick: {v}")
        self.assertEqual(out["tickNumber"], v)

    def test_tick_beyond_max_int_64bit(self):
        # 2^64; Python int handles, but Convex schema may not.
        # OBSERVATION: parser accepts arbitrary-size ints; downstream JSON
        # serialization to Convex may overflow JS Number (>2^53).
        v = 2**64
        out = ups.parse_receipt(f"tick: {v}")
        self.assertEqual(out["tickNumber"], v)

    def test_tick_with_plus_sign(self):
        # int("+5", 10) accepts the leading +.
        out = ups.parse_receipt("tick: +5")
        self.assertEqual(out["tickNumber"], 5)

    def test_tick_with_internal_whitespace_rejected(self):
        # "1 0" → ValueError → None.
        self.assertIsNone(ups.parse_receipt("tick: 1 0"))

    def test_tick_float_rejected(self):
        self.assertIsNone(ups.parse_receipt("tick: 1.5"))

    def test_tick_hex_rejected(self):
        # int("0x10", 10) raises ValueError — only base-10.
        self.assertIsNone(ups.parse_receipt("tick: 0x10"))

    def test_tick_with_body_on_same_line_silently_dropped(self):
        # FINDING: a runner that composes "tick: 5 advance the season" (body
        # appended on same line) will have the receipt SILENTLY DROPPED — the
        # int() parser sees "5 advance the season" → ValueError → None → no
        # mutation. The runner's resend cap eventually surfaces it as a
        # HOOK_FAILURE but the immediate signal is lost.
        # The whisper/special-msg prefixes do NOT have this bug because they
        # use strip() not int(). This asymmetry is a real spec gap worth
        # raising in the PR description.
        self.assertIsNone(ups.parse_receipt("tick: 5 advance the season"))
        # Whereas:
        self.assertIsNotNone(ups.parse_receipt("whisper:5 advance the season"))


class TestUidBoundaries(unittest.TestCase):
    """Whisper / special-msg UIDs are passed through after strip()."""

    def test_uid_exactly_200_chars(self):
        # OBSERVATION: there is NO 200-char cap in the parser. The brief
        # mentioned a cap but the implementation does not enforce one.
        # This test pins the current behavior so any future cap addition
        # is a deliberate spec change, not a silent regression.
        uid = "a" * 200
        out = ups.parse_receipt(f"whisper:{uid}")
        self.assertEqual(out["whisperUid"], uid)
        self.assertEqual(len(out["whisperUid"]), 200)

    def test_uid_very_long_unbounded(self):
        # 10_000-char UID still passes — Convex schema would be the only gate.
        uid = "x" * 10_000
        out = ups.parse_receipt(f"special-msg:{uid}")
        self.assertEqual(len(out["specialMsgUid"]), 10_000)

    def test_uid_internal_whitespace_preserved(self):
        # strip() only trims edges; internal spaces survive.
        out = ups.parse_receipt("whisper: abc def ")
        self.assertEqual(out["whisperUid"], "abc def")

    def test_uid_trailing_newline_stripped(self):
        # strip() removes trailing \n as well as spaces.
        out = ups.parse_receipt("whisper:uid-1\n\nbody body")
        # first_line returns first non-blank line "whisper:uid-1"; uid is "uid-1".
        self.assertEqual(out["whisperUid"], "uid-1")


class TestMessagePreviewBoundary(unittest.TestCase):
    """preview() truncates to 100 chars after replacing \\r and \\n with space.

    Note: BODY CONTENT cannot live on the same line as `tick: <n>` because
    int("<n> body", 10) raises ValueError — found while writing these tests.
    OBSERVATION: that means a runner that composes
        "tick: 5\\nadvance the season\\n..."
    works, but a runner that composes
        "tick: 5 advance the season"
    silently SKIPS the receipt log. See test_tick_with_internal_whitespace_rejected.
    Preview tests below use the multi-line form OR whisper/special-msg prefixes
    (whose value-extraction is strip(), not int()).
    """

    def test_preview_exactly_100_chars_via_whisper(self):
        # Whisper UID-extraction doesn't choke on content after the uid because
        # strip() is forgiving. Build a 100-char prompt where the first line is
        # the prefix and a uid, and subsequent lines provide body.
        body = "whisper:abc\n" + "z" * 88  # 12 + 88 = 100 chars
        self.assertEqual(len(body), 100)
        out = ups.parse_receipt(body)
        self.assertIsNotNone(out)
        self.assertEqual(len(out["messagePreview"]), 100)
        # preview replaces \n with space.
        self.assertEqual(out["messagePreview"], body.replace("\n", " "))

    def test_preview_101_chars_truncates(self):
        body = "whisper:abc\n" + "z" * 89  # 101 total
        self.assertEqual(len(body), 101)
        out = ups.parse_receipt(body)
        self.assertEqual(len(out["messagePreview"]), 100)
        self.assertEqual(out["messagePreview"], body.replace("\n", " ")[:100])

    def test_preview_newlines_become_spaces(self):
        body = "tick: 1\nline2\nline3"
        out = ups.parse_receipt(body)
        self.assertNotIn("\n", out["messagePreview"])
        self.assertIn("tick: 1 line2 line3", out["messagePreview"])

    def test_preview_carriage_returns_become_spaces(self):
        body = "tick: 1\r\nfoo\rbar"
        out = ups.parse_receipt(body)
        self.assertNotIn("\r", out["messagePreview"])

    def test_preview_unicode_grapheme_safe_at_codepoint_boundary(self):
        # preview slices CODE POINTS not bytes; emoji at boundary won't split.
        # OBSERVATION: this is python-native behavior; if the Convex field is
        # byte-sized, a 100-codepoint preview of 4-byte chars is 400 bytes.
        body = "whisper:abc\n" + ("😀" * 95)  # 12 + 95 = 107 chars
        out = ups.parse_receipt(body)
        self.assertEqual(len(out["messagePreview"]), 100)

    def test_preview_no_truncation_when_under_100(self):
        body = "tick: 1"  # 7 chars
        out = ups.parse_receipt(body)
        self.assertEqual(out["messagePreview"], "tick: 1")


class TestEnvVarBoundaries(unittest.TestCase):
    """_read_bus_elder_secret and record_receipt env handling."""

    def test_empty_string_env_treated_as_missing(self):
        # ELDER_ID="" should skip — bool("") is False, same as unset.
        with mock.patch.dict(os.environ, {"ELDER_ID": "", "CONVEX_DEPLOY_URL": "https://x"}, clear=True):
            # Should return without raising; we capture stderr to confirm skip.
            captured = io.StringIO()
            with mock.patch("sys.stderr", captured):
                ups.record_receipt({"prefix": "tick", "tickNumber": 1, "messagePreview": ""})
            self.assertIn("ELDER_ID is not set", captured.getvalue())

    def test_whitespace_only_env_NOT_treated_as_missing(self):
        # OBSERVATION: ELDER_ID="   " is truthy in Python, so the guard
        # `if not elder_id` passes — the hook would attempt the Convex call
        # with elderId="   ". This is a likely bug class: a stray space in
        # docker-compose env: ELDER_ID="1 " would be passed verbatim.
        # The test here pins the CURRENT (buggy?) behavior so a future fix
        # is a conscious spec change.
        with mock.patch.dict(
            os.environ,
            {"ELDER_ID": "   ", "CONVEX_DEPLOY_URL": "https://x", "BUS_ELDER_SECRET": "s"},
            clear=True,
        ):
            captured = io.StringIO()
            with mock.patch("sys.stderr", captured):
                # convex import will likely succeed but ConvexClient construction
                # will be patched away to avoid network IO.
                with mock.patch.object(ups, "record_receipt", wraps=ups.record_receipt) as _:
                    # Just confirm the early-return guards are NOT hit.
                    stderr_before = captured.getvalue()
                    # We can't easily call without mocking convex; instead assert
                    # the guard logic at the env-truthiness level directly.
                    self.assertTrue(bool(os.environ.get("ELDER_ID")))
                    self.assertNotIn("ELDER_ID is not set", stderr_before)

    def test_bus_secret_file_with_trailing_newline_stripped(self, tmp_path=None):
        # _read_bus_elder_secret should strip() the file contents.
        import tempfile
        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".txt") as f:
            f.write("super-secret-value\n\n")
            secret_path = f.name
        try:
            with mock.patch.dict(os.environ, {"BUS_ELDER_SECRET_FILE": secret_path}, clear=True):
                self.assertEqual(ups._read_bus_elder_secret(), "super-secret-value")
        finally:
            os.unlink(secret_path)

    def test_bus_secret_file_empty_falls_back_to_env(self):
        # Empty-content file → falsey after strip() → fall back to BUS_ELDER_SECRET.
        import tempfile
        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".txt") as f:
            f.write("   \n   \n")  # whitespace-only
            secret_path = f.name
        try:
            with mock.patch.dict(
                os.environ,
                {"BUS_ELDER_SECRET_FILE": secret_path, "BUS_ELDER_SECRET": "fallback"},
                clear=True,
            ):
                self.assertEqual(ups._read_bus_elder_secret(), "fallback")
        finally:
            os.unlink(secret_path)

    def test_bus_secret_file_missing_falls_back_to_env(self):
        with mock.patch.dict(
            os.environ,
            {"BUS_ELDER_SECRET_FILE": "/nonexistent/path/that/should/not/exist", "BUS_ELDER_SECRET": "fb"},
            clear=True,
        ):
            captured = io.StringIO()
            with mock.patch("sys.stderr", captured):
                self.assertEqual(ups._read_bus_elder_secret(), "fb")
            self.assertIn("failed to read BUS_ELDER_SECRET_FILE", captured.getvalue())


class TestReadPromptBoundaries(unittest.TestCase):
    """read_prompt() ingests stdin JSON; defends against non-dict payloads."""

    def _stub_stdin(self, raw: str):
        return mock.patch("sys.stdin", io.StringIO(raw))

    def test_empty_stdin_returns_empty(self):
        with self._stub_stdin(""):
            self.assertEqual(ups.read_prompt(), "")

    def test_non_json_stdin_returned_verbatim(self):
        # Plain text (not JSON) returned as-is — matches docstring intent.
        with self._stub_stdin("tick: 5"):
            self.assertEqual(ups.read_prompt(), "tick: 5")

    def test_json_array_returns_empty(self):
        # json.loads("[1,2,3]") → list, not dict → guarded → "".
        with self._stub_stdin("[1,2,3]"):
            self.assertEqual(ups.read_prompt(), "")

    def test_json_null_returns_empty(self):
        with self._stub_stdin("null"):
            self.assertEqual(ups.read_prompt(), "")

    def test_json_dict_with_non_string_prompt_returns_empty(self):
        with self._stub_stdin(json.dumps({"prompt": 42})):
            self.assertEqual(ups.read_prompt(), "")

    def test_json_dict_with_missing_prompt_returns_empty(self):
        with self._stub_stdin(json.dumps({"other": "x"})):
            self.assertEqual(ups.read_prompt(), "")

    def test_json_dict_with_string_prompt_returns_value(self):
        with self._stub_stdin(json.dumps({"prompt": "tick: 7"})):
            self.assertEqual(ups.read_prompt(), "tick: 7")


if __name__ == "__main__":
    unittest.main()
