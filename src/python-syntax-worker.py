#!/usr/bin/env python3
"""Emit exact, source-bound Python declaration and operational-syntax facts."""

from __future__ import annotations

import ast
import hashlib
import json
import pathlib
import sys


EVENT_KINDS = (
    "call",
    "construct",
    "branch",
    "loop",
    "return",
    "throw",
    "await",
    "yield",
    "mutation",
    "guard",
)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def span(node: ast.AST) -> dict[str, dict[str, int]]:
    return {
        "start": {
            "line": int(getattr(node, "lineno", 1)),
            "column": int(getattr(node, "col_offset", 0)) + 1,
        },
        "end": {
            "line": int(getattr(node, "end_lineno", getattr(node, "lineno", 1))),
            "column": int(getattr(node, "end_col_offset", getattr(node, "col_offset", 0))) + 1,
        },
    }


def segment(source: str, node: ast.AST) -> str:
    return ast.get_source_segment(source, node) or ""


def plain_count(value: int) -> str:
    if value == 0:
        return "no"
    if value == 1:
        return "one"
    return str(value)


def plain_language(inputs: list[dict], counts: dict[str, int]) -> str:
    calls = counts["call"] + counts["construct"]
    return (
        f"The parser observed {plain_count(len(inputs))} declared input"
        f"{'' if len(inputs) == 1 else 's'}, {plain_count(calls)} call or construction site"
        f"{'' if calls == 1 else 's'}, {plain_count(counts['branch'])} branch"
        f"{'' if counts['branch'] == 1 else 'es'}, {plain_count(counts['loop'])} loop"
        f"{'' if counts['loop'] == 1 else 's'}, {plain_count(counts['return'])} return"
        f"{'' if counts['return'] == 1 else 's'}, {plain_count(counts['throw'])} thrown exception"
        f"{'' if counts['throw'] == 1 else 's'}, and {plain_count(counts['mutation'])} mutation site"
        f"{'' if counts['mutation'] == 1 else 's'} inside this exact declaration. "
        "These are source-syntax facts, not a claim about author intent or runtime effects."
    )


def parameter_nodes(node: ast.AST) -> list[ast.arg]:
    arguments = getattr(node, "args", None)
    if not isinstance(arguments, ast.arguments):
        return []
    rows = [*arguments.posonlyargs, *arguments.args]
    if arguments.vararg is not None:
        rows.append(arguments.vararg)
    rows.extend(arguments.kwonlyargs)
    if arguments.kwarg is not None:
        rows.append(arguments.kwarg)
    return rows


def mutation_subject(source: str, node: ast.AST) -> str | None:
    if isinstance(node, (ast.Assign, ast.Delete)):
        return ", ".join(segment(source, target) for target in node.targets)
    if isinstance(node, (ast.AnnAssign, ast.AugAssign, ast.NamedExpr)):
        return segment(source, node.target)
    return None


def event_for(source: str, node: ast.AST) -> dict | None:
    kind = None
    subject = None
    if isinstance(node, ast.Call):
        kind = "call"
        subject = segment(source, node.func)
    elif isinstance(node, (ast.If, ast.IfExp, ast.Match)):
        kind = "branch"
    elif isinstance(node, (ast.For, ast.AsyncFor, ast.While)):
        kind = "loop"
    elif isinstance(node, ast.Return):
        kind = "return"
    elif isinstance(node, ast.Raise):
        kind = "throw"
    elif isinstance(node, ast.Await):
        kind = "await"
    elif isinstance(node, (ast.Yield, ast.YieldFrom)):
        kind = "yield"
    elif isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign, ast.NamedExpr, ast.Delete)):
        kind = "mutation"
        subject = mutation_subject(source, node)
    elif isinstance(node, (ast.Try, ast.TryStar, ast.ExceptHandler, ast.With, ast.AsyncWith, ast.Assert)):
        kind = "guard"
    if kind is None:
        return None
    text = segment(source, node)
    return {
        "kind": kind,
        "subject": subject,
        "syntaxKind": type(node).__name__,
        **span(node),
        "sourceSha256": sha256(text),
    }


class BehaviorVisitor(ast.NodeVisitor):
    def __init__(self, source: str, root: ast.AST):
        self.source = source
        self.root = root
        self.events: list[dict] = []
        self.node_counts: dict[str, int] = {}

    def visit(self, node: ast.AST):
        if node is not self.root and isinstance(
            node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)
        ):
            return None
        node_type = type(node).__name__
        self.node_counts[node_type] = self.node_counts.get(node_type, 0) + 1
        event = event_for(self.source, node)
        if event is not None:
            self.events.append(event)
        return super().visit(node)


def operational_behavior(source_path: str, source: str, node: ast.AST, body_sha256: str) -> dict:
    inputs = []
    for parameter in parameter_nodes(node):
        text = segment(source, parameter)
        inputs.append(
            {
                "text": text,
                "name": parameter.arg,
                "syntaxKind": type(parameter).__name__,
                **span(parameter),
                "sourceSha256": sha256(text),
            }
        )
    visitor = BehaviorVisitor(source, node)
    visitor.visit(node)
    counts = {kind: 0 for kind in EVENT_KINDS}
    for event in visitor.events:
        counts[event["kind"]] += 1
    return {
        "schemaVersion": "arc-atlas-operational-syntax-v1",
        "status": "exact-parser-derived",
        "sourceSpan": {"path": source_path, **span(node), "bodySha256": body_sha256},
        "declaredInputs": inputs,
        "eventCounts": counts,
        "events": visitor.events,
        "syntaxNodeCounts": dict(sorted(visitor.node_counts.items())),
        "plainLanguage": plain_language(inputs, counts),
        "resolutionCeiling": "syntax-only-no-binding-runtime-effect-or-author-intent",
        "authority": "exact-syntax-only-not-runtime-effect-or-author-intent",
    }


def node_kind(node: ast.AST, parents: list[tuple[str, str]]) -> str:
    if isinstance(node, ast.ClassDef):
        return "class"
    if isinstance(node, ast.Lambda):
        return "lambda"
    inside_class = bool(parents and parents[-1][1] == "class")
    if isinstance(node, ast.AsyncFunctionDef):
        return "async-method" if inside_class else "async-function"
    return "method" if inside_class else "function"


class DeclarationVisitor(ast.NodeVisitor):
    def __init__(self, source_path: str, source: str):
        self.source_path = source_path
        self.source = source
        self.parents: list[tuple[str, str]] = []
        self.rows: list[dict] = []

    def record(self, node: ast.AST, name: str):
        kind = node_kind(node, self.parents)
        qualified = ".".join([entry[0] for entry in self.parents] + [name])
        text = segment(self.source, node)
        body_sha256 = sha256(text)
        docstring = ast.get_docstring(node, clean=True) if isinstance(
            node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
        ) else ""
        self.rows.append(
            {
                "name": name,
                "qualifiedLocalName": qualified,
                "kind": kind,
                **span(node),
                "signature": self.source.splitlines()[getattr(node, "lineno", 1) - 1].strip(),
                "bodySha256": body_sha256,
                "docstring": docstring or "",
                "operationalBehavior": operational_behavior(
                    self.source_path, self.source, node, body_sha256
                ),
            }
        )
        self.parents.append((name, kind))
        self.generic_visit(node)
        self.parents.pop()

    def visit_ClassDef(self, node: ast.ClassDef):
        self.record(node, node.name)

    def visit_FunctionDef(self, node: ast.FunctionDef):
        self.record(node, node.name)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef):
        self.record(node, node.name)

    def visit_Lambda(self, node: ast.Lambda):
        name = f"<lambda@{node.lineno}:{node.col_offset + 1}>"
        self.record(node, name)


class WholeFileSourceSiteVisitor(ast.NodeVisitor):
    def __init__(self, source_path: str, source: str):
        self.source_path = source_path
        self.source = source
        self.rows: list[dict] = []

    def add(self, node: ast.AST, roles: list[str], spelling: str | None, literal: str | None):
        text = segment(self.source, node)
        self.rows.append(
            {
                "path": self.source_path,
                "language": "Python",
                "syntaxKind": type(node).__name__,
                **span(node),
                "sourceSha256": sha256(text),
                "roles": sorted(set(roles)),
                "spelling": spelling,
                "literalSpecifier": literal,
                "specifierState": "literal" if literal is not None and any(
                    role in {"static-import", "from-import"} for role in roles
                ) else "not-applicable",
                "parserAdapter": "python-ast",
                "authority": "exact-whole-file-python-ast-syntax",
            }
        )

    def visit_Call(self, node: ast.Call):
        self.add(node, ["call"], segment(self.source, node.func), None)
        self.generic_visit(node)

    def visit_Import(self, node: ast.Import):
        for alias in node.names:
            self.add(node, ["static-import"], alias.name, alias.name)

    def visit_ImportFrom(self, node: ast.ImportFrom):
        module = "." * int(node.level or 0) + (node.module or "")
        self.add(node, ["from-import"], module, module)


def main() -> None:
    absolute = pathlib.Path(sys.argv[1])
    source_path = sys.argv[2]
    source = absolute.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(absolute), type_comments=True)
    visitor = DeclarationVisitor(source_path, source)
    visitor.visit(tree)
    sites = WholeFileSourceSiteVisitor(source_path, source)
    sites.visit(tree)
    sites.rows.sort(
        key=lambda row: (
            row["start"]["line"], row["start"]["column"], row["end"]["line"],
            row["end"]["column"], row["literalSpecifier"] or "", ",".join(row["roles"])
        )
    )
    print(json.dumps({
        "schemaVersion": "arc-atlas-python-syntax-observation-v2",
        "declarations": visitor.rows,
        "sourceSites": sites.rows,
        "sourceSiteCoverage": {
            "callSites": "full-language-ast-v1",
            "dependencySites": "full-language-ast-v1",
            "authority": "exact-whole-file-python-ast-syntax",
        },
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
