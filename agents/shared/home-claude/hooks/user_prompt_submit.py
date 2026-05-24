#!/usr/bin/env python3
"""Claude Code UserPromptSubmit hook for elder message receipt logging."""

from __future__ import annotations

import json
import os
import sys
from typing import Any


PREFIXES = ("tick:", "whisper:", "special-msg:")
MUTATION_NAME = "tickReceiveLog:recordReceive"


def log(message: str) -> None:
    print(f"[user_prompt_submit] {message}", file=sys.stderr)


def read_prompt() -> str:
    raw = sys.stdin.read()
    if not raw:
        return ""

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return raw

    # json.loads can return non-dict (None / bool / int / list / str); guard
    # before .get() or AttributeError on those edge cases would leak past the
    # JSONDecodeError catch.
    if not isinstance(payload, dict):
        return ""

    prompt = payload.get("prompt")
    return prompt if isinstance(prompt, str) else ""


def first_line(prompt: str) -> str:
    """Return the first non-blank line, after stripping leading whitespace.

    A leading blank line or all-whitespace first line should not cause us
    to skip the receipt — runner-composed messages occasionally have a
    leading newline from string interpolation. We still only inspect the
    FIRST non-blank line; if it doesn't match the prefix allowlist, the
    caller drops the prompt.
    """
    if not prompt:
        return ""
    for line in prompt.splitlines():
        stripped = line.lstrip()
        if stripped:
            return stripped
    return ""


def preview(prompt: str) -> str:
    return prompt.replace("\r", " ").replace("\n", " ")[:100]


def parse_receipt(prompt: str) -> dict[str, Any] | None:
    line = first_line(prompt)
    if not line.startswith(PREFIXES):
        return None

    if line.startswith("tick:"):
        value = line[len("tick:") :].strip()
        try:
            tick_number = int(value, 10)
        except ValueError:
            log(f"ignoring tick prompt with invalid tick number: {value!r}")
            return None
        return {
            "prefix": "tick",
            "tickNumber": tick_number,
            "messagePreview": preview(prompt),
        }

    if line.startswith("whisper:"):
        value = line[len("whisper:") :].strip()
        if not value:
            log("ignoring whisper prompt with empty uid")
            return None
        return {
            "prefix": "whisper",
            "whisperUid": value,
            "messagePreview": preview(prompt),
        }

    value = line[len("special-msg:") :].strip()
    if not value:
        log("ignoring special-msg prompt with empty uid")
        return None
    return {
        "prefix": "special-msg",
        "specialMsgUid": value,
        "messagePreview": preview(prompt),
    }


def _read_bus_elder_secret() -> str | None:
    """Read this elder's bus secret from BUS_ELDER_SECRET_FILE first, then
    optional BUS_ELDER_SECRET raw env. The file mount is canonical in compose;
    keeping it first avoids stale raw env values shadowing the real secret.

    Added in Bundle 4 R1 polish — super-swarm flagged the prior unauthenticated
    public mutation as a HIGH (forged tick receipts → false delivery confirmation).
    """
    path = os.environ.get("BUS_ELDER_SECRET_FILE")
    if path:
        try:
            with open(path, "r", encoding="utf-8") as f:
                secret = f.read().strip()
                if secret:
                    return secret
        except OSError as exc:
            log(f"failed to read BUS_ELDER_SECRET_FILE={path}: {exc}")
    raw = os.environ.get("BUS_ELDER_SECRET")
    if raw:
        return raw
    return None


def record_receipt(args: dict[str, Any]) -> None:
    elder_id = os.environ.get("ELDER_ID")
    convex_url = os.environ.get("CONVEX_DEPLOY_URL")
    secret = _read_bus_elder_secret()
    if not elder_id:
        log("ELDER_ID is not set; skipping receive log")
        return
    if not convex_url:
        log("CONVEX_DEPLOY_URL is not set; skipping receive log")
        return
    if not secret:
        log(
            "BUS_ELDER_SECRET_FILE (or BUS_ELDER_SECRET) is not set; skipping receive log. "
            "The runner's resend cap will eventually surface a HOOK_FAILURE."
        )
        return

    try:
        from convex import ConvexClient
    except Exception as exc:  # pragma: no cover - depends on container deps
        log(f"failed to import convex SDK: {exc}")
        return

    payload = {"secret": secret, "elderId": elder_id, **args}
    client = ConvexClient(convex_url)
    client.mutation(MUTATION_NAME, payload)


def main() -> int:
    try:
        prompt = read_prompt()
        receipt = parse_receipt(prompt)
        if receipt is not None:
            record_receipt(receipt)
    except Exception as exc:
        log(f"non-fatal hook error: {exc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
