from __future__ import annotations

import json
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory

try:
    from .app_core import (
        ITEM_DEFINITIONS,
        build_config_payload,
        build_variant,
        find_definition,
        optimize_loadout_with_cities,
        parse_unique_name,
        search_items,
        serialize_variant,
    )
except ImportError:  # pragma: no cover - convenience for `python main.py`
    from app_core import (  # type: ignore
        ITEM_DEFINITIONS,
        build_config_payload,
        build_variant,
        find_definition,
        optimize_loadout_with_cities,
        parse_unique_name,
        search_items,
        serialize_variant,
    )

ROOT = Path(__file__).resolve().parents[1]
FRONTEND_ROOT = ROOT / "frontend"
FRONTEND_DIST = FRONTEND_ROOT / "dist"
FRONTEND_SRC = FRONTEND_ROOT / "src"

app = Flask(__name__, static_folder=None)


def _frontend_base() -> Path:
    return FRONTEND_DIST if FRONTEND_DIST.exists() else FRONTEND_SRC


@app.after_request
def add_cors_headers(response: Response) -> Response:
    response.headers.setdefault("Access-Control-Allow-Origin", "*")
    response.headers.setdefault("Access-Control-Allow-Headers", "Content-Type")
    response.headers.setdefault("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    return response


@app.get("/api/health")
def health() -> Response:
    return jsonify(
        {
            "status": "ok",
            "items": len(ITEM_DEFINITIONS),
        }
    )


@app.get("/api/config")
def config() -> Response:
    return jsonify(build_config_payload())


@app.get("/api/items")
def items() -> Response:
    query = request.args.get("query", "")
    language = request.args.get("lang", "en")
    slot = request.args.get("slot")
    results = search_items(query=query, language=language, slot=slot)
    return jsonify({"items": results})


@app.get("/api/item/<path:unique_name>")
def item_detail(unique_name: str) -> Response:
    tier, template, enchantment = parse_unique_name(unique_name)
    definition = find_definition(template)
    if definition is None:
        return jsonify({"error": "Item not found"}), 404
    variant = serialize_variant(build_variant(definition, tier, enchantment), language=request.args.get("lang", "en"))
    return jsonify(variant)


@app.post("/api/optimize")
def optimize() -> Response:
    payload = request.get_json(silent=True) or {}
    loadout = payload.get("loadout") or payload.get("slots") or []
    if isinstance(loadout, dict):
        loadout = [{"slot": slot, "unique_name": value.get("unique_name") if isinstance(value, dict) else value} for slot, value in loadout.items()]
    region = payload.get("region", "americas")
    language = payload.get("language", "en")
    cities = payload.get("cities") or []
    if isinstance(cities, str):
        cities = [cities]
    if not isinstance(cities, list):
        cities = []
    optimized = optimize_loadout_with_cities(loadout=loadout, region=region, language=language, cities=cities)
    return jsonify(optimized)


@app.get("/")
def index() -> Response:
    return send_from_directory(_frontend_base(), "index.html")


@app.get("/<path:path>")
def frontend_assets(path: str) -> Response:
    base = _frontend_base()
    asset_path = base / path
    if asset_path.exists() and asset_path.is_file():
        return send_from_directory(base, path)
    return send_from_directory(base, "index.html")


def main() -> None:
    app.run(host="0.0.0.0", port=8000, debug=True)


if __name__ == "__main__":
    main()
