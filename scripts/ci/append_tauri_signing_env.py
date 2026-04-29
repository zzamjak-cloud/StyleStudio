#!/usr/bin/env python3
"""GitHub Actions GITHUB_ENV에 TAURI_SIGNING_PRIVATE_KEY(멀티라인 PEM)를 안전하게 추가합니다."""
from __future__ import annotations

import os
import secrets
import sys


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: append_tauri_signing_env.py <path-to-pem-file>", file=sys.stderr)
        sys.exit(2)
    key_path = sys.argv[1]
    gh_env = os.environ.get("GITHUB_ENV")
    if not gh_env:
        print("GITHUB_ENV is not set", file=sys.stderr)
        sys.exit(1)

    with open(key_path, "rb") as f:
        raw = f.read()
    key = raw.decode("utf-8")
    key = key.replace("\r\n", "\n").replace("\r", "\n")

    # PEM base64 줄과 충돌하지 않도록 긴 랜덤 hex 구분자만 사용
    delim = "TAURI_SS_" + secrets.token_hex(32)

    with open(gh_env, "a", encoding="utf-8", newline="\n") as out:
        out.write(f"TAURI_SIGNING_PRIVATE_KEY<<{delim}\n")
        out.write(key)
        if not key.endswith("\n"):
            out.write("\n")
        out.write(f"{delim}\n")


if __name__ == "__main__":
    main()
