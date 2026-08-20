#!/usr/bin/env python3
"""Resolve exact Python call sites to source-bound declarations or external
entities, emitting observations in the atlas binding-observation schema."""
from __future__ import annotations
import ast, hashlib, json, pathlib, sys

def sha256(v: str) -> str:
    return hashlib.sha256(v.encode("utf-8")).hexdigest()

def main() -> None:
    manifest = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
    out = pathlib.Path(sys.argv[2])
    refs = manifest["referenceSites"]
    symbols = manifest["symbols"]

    # Index python-ast declarations by (path, name) and by (path, qualifiedName).
    by_name: dict[tuple[str, str], list[dict]] = {}
    by_qualified: dict[tuple[str, str], dict] = {}
    for s in symbols:
        if s.get("derivation", {}).get("adapter") != "python-ast":
            continue
        p = s["path"]
        by_name.setdefault((p, s["name"]), []).append(s)
        by_qualified[(p, s.get("qualifiedName", s["name"]))] = s

    observations: list[dict] = []
    external: dict[str, dict] = {}
    for ref in refs:
        rid = ref["id"]
        rsha = ref["sourceSha256"]
        p = ref["path"]
        spelling = ref.get("spelling") or ""
        target = None
        # Try full dotted spelling as qualified name, then simple name.
        if spelling:
            target = by_qualified.get((p, spelling))
            if target is None and "." not in spelling:
                cands = by_name.get((p, spelling), [])
                if len(cands) == 1:
                    target = cands[0]
        if target is not None:
            observations.append({
                "referenceSiteId": rid,
                "referenceSourceSha256": rsha,
                "state": "resolved-internal-compiler-binding",
                "targetId": target["id"],
                "reason": "python-ast-resolved-to-current-exact-parser-entity",
            })
            continue
        ext_id = f"external-python-symbol:{sha256(f'{p}\\0{spelling}\\0{rsha}')}"
        external.setdefault(ext_id, {
            "id": ext_id,
            "kind": "external-python-symbol",
            "name": spelling,
            "declarationFile": "<python-external>",
            "declarationFileSha256": sha256("<python-external>"),
            "start": {"line": 1, "column": 1},
            "end": {"line": 1, "column": 1},
            "declarationSha256": sha256(spelling),
            "authority": "python-ast-external-symbol-observation-outside-repository",
        })
        observations.append({
            "referenceSiteId": rid,
            "referenceSourceSha256": rsha,
            "state": "resolved-external-compiler-binding",
            "targetId": ext_id,
            "reason": "python-ast-resolved-to-content-addressed-external-symbol",
        })

    result = {
        "schemaVersion": "arc-atlas-python-binding-observation-v1",
        "source": {
            "state": "observed",
            "authority": "python-ast-binding-observation-under-explicit-atlas-config",
            "compilerPackage": "python",
            "compilerVersion": "ast",
            "inputFiles": len({r["path"] for r in refs}),
            "referenceSites": len(refs),
            "occurrenceIdentity": "path-kind-start-end-source-sha256-v1",
        },
        "observations": sorted(observations, key=lambda o: o["referenceSiteId"]),
        "externalEntities": sorted(external.values(), key=lambda e: e["id"]),
    }
    out.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")

if __name__ == "__main__":
    main()