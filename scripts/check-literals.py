#!/usr/bin/env python3
"""Fail when a tracked file contains an environment-identifying literal.

The check never prints the matched address, CIDR, or domain. It reports only the
file, line, and category so CI logs and chat transcripts stay free of environment
values.
"""

from __future__ import annotations

import ipaddress
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ALLOWLIST = Path(__file__).with_name("literals-allowlist.txt")

IPV4 = re.compile(r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?:/\d{1,2})?(?![\w.])")
IPV6 = re.compile(
    r"(?<![\w:])(?:[0-9A-Fa-f]{0,4}:){2,}[0-9A-Fa-f]{0,4}(?:/\d{1,3})?(?![\w:])"
)
DOMAIN = re.compile(
    r"(?<![\w.-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+"
    r"([A-Za-z]{2,63})(?![\w.-])"
)

TLDS = {
    "ai",
    "app",
    "au",
    "be",
    "biz",
    "br",
    "ca",
    "ch",
    "cloud",
    "cn",
    "co",
    "com",
    "cz",
    "de",
    "dev",
    "dk",
    "edu",
    "es",
    "eu",
    "example",
    "fi",
    "fr",
    "gov",
    "gr",
    "hk",
    "ie",
    "in",
    "info",
    "int",
    "invalid",
    "io",
    "it",
    "jp",
    "kr",
    "local",
    "mx",
    "mil",
    "net",
    "nl",
    "no",
    "nz",
    "org",
    "pl",
    "pt",
    "ru",
    "se",
    "sg",
    "test",
    "tr",
    "uk",
    "us",
    "za",
}


@dataclass(frozen=True)
class Allowlist:
    networks: tuple[ipaddress._BaseNetwork, ...]
    domains: frozenset[str]
    tokens: frozenset[str]


def load_allowlist() -> Allowlist:
    networks: list[ipaddress._BaseNetwork] = []
    domains: set[str] = set()
    tokens: set[str] = set()

    for number, raw_line in enumerate(ALLOWLIST.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        kind, separator, value = line.partition(" ")
        if not separator or not value.strip():
            raise SystemExit(f"{ALLOWLIST}:{number}: invalid allowlist entry")
        value = value.strip()
        if kind == "network":
            networks.append(ipaddress.ip_network(value, strict=False))
        elif kind == "domain":
            domains.add(value.lower().lstrip("."))
        elif kind == "token":
            tokens.add(value)
        else:
            raise SystemExit(f"{ALLOWLIST}:{number}: unknown allowlist kind {kind!r}")

    return Allowlist(tuple(networks), frozenset(domains), frozenset(tokens))


def network_allowed(value: str, allowlist: Allowlist) -> bool:
    if value in allowlist.tokens:
        return True
    try:
        network = ipaddress.ip_network(value, strict=False)
    except ValueError:
        return True  # Not an address; another matcher or the YAML parser owns it.
    for allowed in allowlist.networks:
        if network.version == allowed.version and network.subnet_of(allowed):
            return True
    return False


def domain_allowed(value: str, allowlist: Allowlist) -> bool:
    domain = value.lower().rstrip(".")
    return any(
        domain == suffix or domain.endswith(f".{suffix}") for suffix in allowlist.domains
    )


def tracked_files() -> list[Path]:
    output = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT,
    )
    return [ROOT / item.decode("utf-8") for item in output.split(b"\0") if item]


def is_encrypted_sops(text: str) -> bool:
    lines = text.splitlines()
    return any(line.strip() == "sops:" for line in lines[:10])


def main() -> int:
    allowlist = load_allowlist()
    failures: list[str] = []

    for path in tracked_files():
        relative = path.relative_to(ROOT)
        try:
            raw = path.read_bytes()
        except OSError:
            continue
        if b"\0" in raw:
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue
        if is_encrypted_sops(text):
            continue

        for number, line in enumerate(text.splitlines(), 1):
            categories: set[str] = set()

            for match in IPV4.finditer(line):
                if not network_allowed(match.group(), allowlist):
                    categories.add("ipv4")
            for match in IPV6.finditer(line):
                if not network_allowed(match.group(), allowlist):
                    categories.add("ipv6")
            for match in DOMAIN.finditer(line):
                if match.group(1).lower() not in TLDS:
                    continue
                if not domain_allowed(match.group(), allowlist):
                    categories.add("domain")

            for category in sorted(categories):
                failures.append(f"{relative}:{number} [{category}]")

    if failures:
        print("Forbidden environment literals found:", file=sys.stderr)
        for failure in failures:
            print(f"  {failure}", file=sys.stderr)
        print(
            "Replace the value with a reserved documentation value or move it "
            "to the encrypted environment file.",
            file=sys.stderr,
        )
        return 1

    print("Literal check passed: no environment-identifying literals in tracked files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
