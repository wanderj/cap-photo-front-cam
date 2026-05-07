from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

MAX_UPLOAD_SIZE = 8 * 1024 * 1024  # 8MB
BASE_DIR = Path(__file__).resolve().parent.parent
UPLOADS_DIR = BASE_DIR / "uploads"
METADATA_FILE = UPLOADS_DIR / "metadata.jsonl"

app = FastAPI(title="Secure Camera Capture API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://cap-photo-front-cam.onrender.com",
        "https://www.cap-photo-front-cam.onrender.com",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ],
    allow_credentials=False,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


def ensure_uploads_dir() -> None:
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


def sanitize_ip(ip: str) -> str:
    token = re.sub(r"[^A-Za-z0-9._-]", "_", ip)
    token = re.sub(r"_+", "_", token).strip("._-")
    return token or "unknown"


def resolve_client_ip(request: Request) -> str:
    # In local mode trust direct client address; keep proxy headers as fallback only.
    if request.client and request.client.host:
        return request.client.host

    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()

    return "unknown"


def is_valid_jpeg(data: bytes) -> bool:
    if len(data) < 4:
        return False
    return data.startswith(b"\xff\xd8") and data.endswith(b"\xff\xd9")


def append_metadata(record: dict) -> None:
    ensure_uploads_dir()
    with METADATA_FILE.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=True) + "\n")


@app.middleware("http")
async def enforce_content_length(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_UPLOAD_SIZE:
                return JSONResponse(
                    status_code=413,
                    content={"detail": "Payload too large. Max size is 8MB."},
                )
        except ValueError:
            return JSONResponse(
                status_code=400,
                content={"detail": "Invalid Content-Length header."},
            )
    return await call_next(request)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/upload")
async def upload_image(
    request: Request,
    image: UploadFile = File(...),
    user_agent: str = Form(default=""),
):
    ensure_uploads_dir()

    data = await image.read()
    if not data:
        return JSONResponse(status_code=400, content={"detail": "Empty upload."})

    if len(data) > MAX_UPLOAD_SIZE:
        return JSONResponse(
            status_code=413,
            content={"detail": "Payload too large. Max size is 8MB."},
        )

    if image.content_type not in {"image/jpeg", "image/jpg", "image/pjpeg"}:
        return JSONResponse(
            status_code=415,
            content={"detail": "Unsupported media type. Use JPEG."},
        )

    if not is_valid_jpeg(data):
        return JSONResponse(
            status_code=400,
            content={"detail": "Invalid JPEG payload."},
        )

    ip = sanitize_ip(resolve_client_ip(request))
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    file_name = f"{timestamp}_{ip}.jpg"
    file_path = UPLOADS_DIR / file_name

    file_path.write_bytes(data)

    record = {
        "timestamp": timestamp,
        "ip": ip,
        "user_agent": (user_agent or request.headers.get("user-agent", ""))[:512],
        "filename": file_name,
        "size_bytes": len(data),
    }
    append_metadata(record)

    return {
        "message": "Upload successful.",
        "filename": file_name,
        "size_bytes": len(data),
        "ip": ip,
    }
