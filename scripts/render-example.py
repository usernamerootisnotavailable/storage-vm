#!/usr/bin/env python3
"""Render a committed example file, replacing generation markers.

The script writes to a caller-supplied temporary path and never prints the
generated values. It is intentionally not a general-purpose templating tool.
"""

from __future__ import annotations

import argparse
import os
import re
import secrets
import sys

MARKERS = {
    "__GENERATE_HEX_8__": lambda: secrets.token_hex(8),
    "__GENERATE_HEX_32__": lambda: secrets.token_hex(32),
}
UNKNOWN_MARKER = re.compile(r"__GENERATE_[A-Za-z0-9_]+__")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", help="Committed example file to render")
    parser.add_argument("output", help="Temporary output path")
    args = parser.parse_args()

    with open(args.input, encoding="utf-8") as handle:
        text = handle.read()

    for marker, generator in MARKERS.items():
        while marker in text:
            text = text.replace(marker, generator(), 1)

    if UNKNOWN_MARKER.search(text):
        print(f"Unknown generation marker remains in {args.input}", file=sys.stderr)
        return 1

    descriptor = os.open(
        args.output,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL,
        0o600,
    )
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
