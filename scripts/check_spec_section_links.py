#!/usr/bin/env python3
"""Fail if section references like '§10.2' are not clickable markdown links.

Also validates that internal '#sec-...' links point to an existing anchor.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


SECTION_REF_RE = re.compile(r"§[0-9]+(?:\.[0-9]+)*")
MD_LINK_RE = re.compile(r"\[[^\]]+\]\([^)]+\)")
ANCHOR_RE = re.compile(r'<a id="([^"]+)"></a>')
INTERNAL_LINK_RE = re.compile(r"\[[^\]]+\]\(#([^)]+)\)")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)


def _line_col(text: str, pos: int) -> tuple[int, int]:
    line = text.count("\n", 0, pos) + 1
    col = pos - text.rfind("\n", 0, pos)
    return line, col


def _within_any_span(pos: int, spans: list[tuple[int, int]]) -> bool:
    for start, end in spans:
        if start <= pos < end:
            return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check that all § references are clickable and anchors resolve."
    )
    parser.add_argument(
        "file",
        nargs="?",
        default="spec/oojs-spec.md",
        help="Spec markdown file to validate (default: spec/oojs-spec.md)",
    )
    args = parser.parse_args()

    path = Path(args.file)
    text = path.read_text(encoding="utf-8")

    link_spans = [(m.start(), m.end()) for m in MD_LINK_RE.finditer(text)]
    anchors = {m.group(1) for m in ANCHOR_RE.finditer(text)}

    # Accept GitHub-style heading anchors used by markdown renderers.
    def heading_slug(raw: str) -> str:
        s = raw.strip().lower()
        s = re.sub(r"`", "", s)
        s = re.sub(r"[^\w\s-]", "", s)
        s = re.sub(r"\s", "-", s)
        return s.strip("-")

    heading_anchors = {heading_slug(m.group(2)) for m in HEADING_RE.finditer(text)}
    all_anchors = anchors | heading_anchors

    errors: list[str] = []

    for m in SECTION_REF_RE.finditer(text):
        if not _within_any_span(m.start(), link_spans):
            line, col = _line_col(text, m.start())
            errors.append(
                f"{path}:{line}:{col}: unlinked section reference '{m.group(0)}'"
            )

    for m in INTERNAL_LINK_RE.finditer(text):
        target = m.group(1)
        if target not in all_anchors:
            line, col = _line_col(text, m.start())
            errors.append(
                f"{path}:{line}:{col}: broken internal link '#{target}' (anchor missing)"
            )

    if errors:
        print("Spec link check failed:")
        for err in errors:
            print(f"- {err}")
        return 1

    print(f"Spec link check passed: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
