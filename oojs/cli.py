"""Command-line interface for OOJS validation.

Usage:
    python -m oojs validate --schema clinical.oojs.json --type Encounter instance.json
    python -m oojs validate --schema clinical.oojs.json --type Observation - < instance.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .loader import Registry, SchemaError
from .validator import Validator


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="oojs",
        description="OOJS v1.0 reference validator",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # validate subcommand
    val = sub.add_parser("validate", help="Validate an instance against a schema type")
    val.add_argument(
        "--schema", "-s",
        required=True,
        metavar="FILE",
        help="Path to the .oojs.json schema file",
    )
    val.add_argument(
        "--type", "-t",
        required=True,
        metavar="TYPE",
        dest="target_type",
        help="Target type name to validate against",
    )
    val.add_argument(
        "--fail-fast", "-f",
        action="store_true",
        help="Stop after the first validation error",
    )
    val.add_argument(
        "--import", "-i",
        action="append",
        metavar="ALIAS=FILE",
        dest="imports",
        help="Pre-load an imported schema (alias=path); may be repeated",
    )
    val.add_argument(
        "instance",
        metavar="INSTANCE",
        help="Path to the JSON instance file, or '-' for stdin",
    )

    # inspect subcommand
    insp = sub.add_parser("inspect", help="Print resolved type information from a schema")
    insp.add_argument("schema", metavar="FILE", help="Path to the .oojs.json schema file")
    insp.add_argument("--type", "-t", metavar="TYPE", dest="target_type",
                      help="Show details for a single type")

    return parser


def cmd_validate(args: argparse.Namespace) -> int:
    registry = Registry()

    # Pre-load imports
    for imp in args.imports or []:
        if "=" not in imp:
            print(f"error: --import must be in 'alias=file' format, got '{imp}'", file=sys.stderr)
            return 2
        alias, path = imp.split("=", 1)
        try:
            registry.load_file(path)
        except (SchemaError, OSError, json.JSONDecodeError) as e:
            print(f"error loading import '{alias}' from '{path}': {e}", file=sys.stderr)
            return 2

    # Load main schema
    try:
        schema = registry.load_file(args.schema)
    except (SchemaError, OSError, json.JSONDecodeError) as e:
        print(f"error loading schema '{args.schema}': {e}", file=sys.stderr)
        return 2

    # Resolve target type
    typedef = schema.types.get(args.target_type)
    if typedef is None:
        print(
            f"error: type '{args.target_type}' not found in schema '{schema.schema_id}'",
            file=sys.stderr,
        )
        return 2

    # Load instance
    try:
        if args.instance == "-":
            raw = sys.stdin.read()
        else:
            raw = Path(args.instance).read_text(encoding="utf-8")
        instance = json.loads(raw)
    except (OSError, json.JSONDecodeError) as e:
        print(f"error reading instance: {e}", file=sys.stderr)
        return 2

    # Validate
    validator = Validator(registry, fail_fast=args.fail_fast)
    errors = validator.validate(instance, typedef, schema)

    if not errors:
        print("valid")
        return 0

    for err in errors:
        print(err)
    return 1


def cmd_inspect(args: argparse.Namespace) -> int:
    registry = Registry()
    try:
        schema = registry.load_file(args.schema)
    except (SchemaError, OSError, json.JSONDecodeError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    if args.target_type:
        typedef = schema.types.get(args.target_type)
        if typedef is None:
            print(f"error: type '{args.target_type}' not found", file=sys.stderr)
            return 2
        _print_type(typedef, schema)
    else:
        for name, typedef in schema.types.items():
            _print_type(typedef, schema)
            print()

    return 0


def _print_type(typedef, schema) -> None:
    flags = []
    if typedef.abstract:
        flags.append("abstract")
    flag_str = f"  [{', '.join(flags)}]" if flags else ""
    parent = f" extends {typedef.supertype.name}" if typedef.supertype else ""
    print(f"Type: {typedef.name}{parent}{flag_str}")
    print(f"  discriminatorValue: {typedef.effective_discriminator_value}")
    eff_props = typedef.effective_properties()
    eff_req = set(typedef.effective_required())
    if eff_props:
        print("  properties:")
        for pname, pdef in eff_props.items():
            req_mark = "*" if pname in eff_req else " "
            from .model import PrimitiveProperty, TypeRefProperty, ArrayProperty
            if isinstance(pdef, PrimitiveProperty):
                ptype = pdef.kind
            elif isinstance(pdef, TypeRefProperty):
                ptype = pdef.type_name
            elif isinstance(pdef, ArrayProperty):
                from .model import TypeRefProperty as TRP
                item_type = (
                    pdef.items.kind if isinstance(pdef.items, PrimitiveProperty)
                    else pdef.items.type_name if isinstance(pdef.items, TRP)
                    else "?"
                )
                ptype = f"array<{item_type}>"
            else:
                ptype = "?"
            print(f"    {req_mark} {pname}: {ptype}")


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.command == "validate":
        return cmd_validate(args)
    if args.command == "inspect":
        return cmd_inspect(args)

    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
