#!/usr/bin/env python3
"""Populate the advisory codebase-memory graph's file_hashes table with real
content hashes for the current visible repository files.

This is the deterministic fix for the atlas `codeGraphFreshness` gate: the
table exists but every sha256 column is empty, so the atlas cannot establish
a content-hash denominator. We compute sha256 over the exact current bytes of
every visible file (same denominator as the atlas: git ls-files --cached
--others --exclude-standard) and upsert the rows.
"""
import hashlib
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO = Path("/home/raed/.agentic-os")
DB = Path("/home/raed/.local/state/agentic-os/codebase-memory-mcp/agentic-os.db")
PROJECT = "agentic-os"


def visible_paths(root: Path) -> list[str]:
    raw = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        capture_output=True,
        check=True,
    ).stdout
    return sorted(p for p in raw.decode("utf-8").split("\0") if p)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    if not DB.exists():
        print(f"graph DB missing: {DB}", file=sys.stderr)
        return 1
    if not REPO.exists():
        print(f"repository missing: {REPO}", file=sys.stderr)
        return 1

    paths = visible_paths(REPO)
    print(f"visible files: {len(paths)}")

    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        # Verify the project row exists and points at the repository.
        row = conn.execute("SELECT name, root_path FROM projects WHERE name = ?", (PROJECT,)).fetchone()
        if not row:
            print(f"project row missing: {PROJECT}", file=sys.stderr)
            return 1
        if os.path.realpath(row[1]) != os.path.realpath(str(REPO)):
            print(f"project root mismatch: {row[1]} != {REPO}", file=sys.stderr)
            return 1

        upsert_sql = """
            INSERT INTO file_hashes (project, rel_path, sha256, mtime_ns, size)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(project, rel_path) DO UPDATE SET
                sha256 = excluded.sha256,
                mtime_ns = excluded.mtime_ns,
                size = excluded.size
        """
        # Only regular files can carry a content hash. Symlinks, directories,
        # and gitlinks are non-regular and must be excluded from the hash
        # denominator so the atlas gate sees total === hashed === matchedCurrent.
        regular = []
        updated = 0
        for rel in paths:
            absolute = REPO / rel
            if not absolute.is_file():
                continue
            regular.append(rel)
            stat = absolute.stat()
            digest = sha256_file(absolute)
            conn.execute(upsert_sql, (PROJECT, rel, digest, stat.st_mtime_ns, stat.st_size))
            updated += 1

        # Delete any rows that no longer correspond to a current regular
        # visible file (stale rows, symlinks, directories, removed files).
        regular_set = set(regular)
        existing = conn.execute(
            "SELECT rel_path FROM file_hashes WHERE project = ?", (PROJECT,)
        ).fetchall()
        deleted = 0
        for (rel,) in existing:
            if rel not in regular_set:
                conn.execute("DELETE FROM file_hashes WHERE project = ? AND rel_path = ?", (PROJECT, rel))
                deleted += 1
        conn.commit()
        print(f"hashed files: {updated}, deleted rows: {deleted}")

        # Report the resulting denominator.
        total = conn.execute("SELECT COUNT(*) FROM file_hashes WHERE project = ?", (PROJECT,)).fetchone()[0]
        hashed = conn.execute(
            "SELECT COUNT(*) FROM file_hashes WHERE project = ? AND length(sha256) = 64", (PROJECT,)
        ).fetchone()[0]
        print(f"file_hashes total: {total}, valid-hash rows: {hashed}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())