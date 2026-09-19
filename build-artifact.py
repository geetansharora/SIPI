#!/usr/bin/env python3
"""Flatten a multi-file SI&PI page into a single self-contained fragment.

The site itself ships as separate css/js files (normal static hosting).
Claude Artifacts blocks external stylesheets and scripts other than Google
Fonts, and supplies its own <!doctype>/<head>/<body> skeleton — so for a
shareable preview we inline every local asset and emit body content only.

    python3 build-artifact.py topics/fundamentals/reflections.html out.html
"""
import re
import sys
from pathlib import Path


def flatten(src: Path) -> str:
    html = src.read_text(encoding="utf-8")
    base = src.parent

    title = re.search(r"<title>(.*?)</title>", html, re.S)
    title = title.group(1).strip() if title else src.stem

    keep_links = re.findall(
        r'<link[^>]+href="(https://fonts\.googleapis\.com[^"]+)"[^>]*>', html
    )

    parts = [f"<title>{title}</title>"]
    parts += ['<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>']
    parts += [f'<link rel="stylesheet" href="{h}">' for h in keep_links]

    for href in re.findall(r'<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"', html):
        if href.startswith("http"):
            continue
        # strip the ?v= cache-bust stamp scaffold.py adds — it is a URL, not a path
        css = (base / href.split("?")[0]).resolve().read_text(encoding="utf-8")
        parts.append(f"<style>\n{css}\n</style>")

    body = re.search(r"<body[^>]*>(.*)</body>", html, re.S)
    body = body.group(1) if body else html
    # drop the local <script src> tags; their contents get inlined below
    body = re.sub(r'<script src="(?!http)[^"]+"></script>\s*', "", body)
    parts.append(body.strip())

    for src_attr in re.findall(r'<script src="([^"]+)"></script>', html):
        if src_attr.startswith("http"):
            continue
        js = (base / src_attr.split("?")[0]).resolve().read_text(encoding="utf-8")
        parts.append(f"<script>\n{js}\n</script>")

    return "\n\n".join(parts) + "\n"


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    out = Path(sys.argv[2])
    out.write_text(flatten(Path(sys.argv[1])), encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size:,} bytes)")
