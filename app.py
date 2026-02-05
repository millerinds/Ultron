from __future__ import annotations

import os
from pathlib import Path

from flask import Flask, jsonify, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
DIST_DIR = BASE_DIR / "dist"

app = Flask(__name__, static_folder=str(DIST_DIR), static_url_path="")


@app.get("/config.json")
def config() -> tuple[dict[str, str | None], int]:
    """Expose the Gemini API key at runtime for the frontend.

    The key is intentionally sent to the browser because the existing UI
    performs client-side calls directly to Gemini. Ensure you trust where
    you host this app before setting the key.
    """
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("API_KEY")
    return {"apiKey": api_key}, 200


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_client(path: str):
    # Serve static assets if they exist, otherwise fall back to index.html
    target = DIST_DIR / path
    if target.exists() and target.is_file():
        return send_from_directory(app.static_folder, path)

    # If the build is missing, give a clear error.
    index_file = DIST_DIR / "index.html"
    if not index_file.exists():
        return (
            "dist/index.html não encontrado. Rode `npm install && npm run build` antes de `flask run`.",
            500,
        )

    return send_from_directory(app.static_folder, "index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5100)), debug=True)
