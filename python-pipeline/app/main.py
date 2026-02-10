import os
import re
import time
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import cv2
import fitz
import numpy as np
import pytesseract
import requests
from fastapi import Depends, FastAPI, Header, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

app = FastAPI(title="TGN Python Pipeline", version="0.1.0")
_CACHE_WRITE_COUNT = 0


def _require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    expected = os.getenv("PIPELINE_API_KEY", "").strip()
    if expected and x_api_key != expected:
        raise HTTPException(status_code=401, detail="Invalid API key")


def _request_timeout_seconds() -> int:
    return int(os.getenv("REQUEST_TIMEOUT_SECONDS", "20"))


def _cache_enabled() -> bool:
    return os.getenv("PIPELINE_DOWNLOAD_CACHE_ENABLED", "1").strip().lower() not in {
        "0",
        "false",
        "no",
    }


def _cache_dir() -> Path:
    return Path(os.getenv("PIPELINE_DOWNLOAD_CACHE_DIR", "/tmp/tgn-pipeline-cache"))


def _cache_ttl_seconds() -> int:
    return max(1, int(os.getenv("PIPELINE_DOWNLOAD_CACHE_TTL_SECONDS", "21600")))


def _cache_max_bytes() -> int:
    return max(1, int(os.getenv("PIPELINE_DOWNLOAD_CACHE_MAX_BYTES", "1073741824")))


def _cache_cleanup_every_writes() -> int:
    return max(1, int(os.getenv("PIPELINE_DOWNLOAD_CACHE_CLEANUP_EVERY_WRITES", "20")))


def _cache_file_path(kind: str, source_url: str) -> Path:
    parsed = urlparse(source_url)
    stable_source = f"{kind}:{parsed.scheme}://{parsed.netloc}{parsed.path}"
    digest = sha256(stable_source.encode("utf-8")).hexdigest()
    extension = Path(parsed.path).suffix.lower()
    if len(extension) > 8:
        extension = ""
    return _cache_dir() / f"{digest}{extension}"


def _cache_get(kind: str, source_url: str) -> bytes | None:
    if not _cache_enabled():
        return None

    cache_path = _cache_file_path(kind, source_url)
    try:
        stat = cache_path.stat()
    except FileNotFoundError:
        return None

    now = time.time()
    if now - stat.st_mtime > _cache_ttl_seconds():
        try:
            cache_path.unlink(missing_ok=True)
        except OSError:
            pass
        return None

    try:
        data = cache_path.read_bytes()
        os.utime(cache_path, None)
        return data
    except OSError:
        return None


def _cache_cleanup() -> None:
    cache_directory = _cache_dir()
    try:
        cache_directory.mkdir(parents=True, exist_ok=True)
    except OSError:
        return

    now = time.time()
    ttl = _cache_ttl_seconds()
    max_bytes = _cache_max_bytes()
    files: list[tuple[Path, float, int]] = []

    for path in cache_directory.iterdir():
        if not path.is_file():
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        if now - stat.st_mtime > ttl:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
            continue
        files.append((path, stat.st_mtime, stat.st_size))

    files.sort(key=lambda row: row[1], reverse=True)
    total_size = sum(row[2] for row in files)
    for path, _, size in files:
        if total_size <= max_bytes:
            break
        try:
            path.unlink(missing_ok=True)
            total_size -= size
        except OSError:
            continue


def _cache_put(kind: str, source_url: str, payload: bytes) -> None:
    if not _cache_enabled():
        return

    cache_directory = _cache_dir()
    try:
        cache_directory.mkdir(parents=True, exist_ok=True)
    except OSError:
        return

    cache_path = _cache_file_path(kind, source_url)
    temp_path = cache_path.with_suffix(f"{cache_path.suffix}.tmp")
    try:
        temp_path.write_bytes(payload)
        temp_path.replace(cache_path)
        global _CACHE_WRITE_COUNT
        _CACHE_WRITE_COUNT += 1
        if _CACHE_WRITE_COUNT % _cache_cleanup_every_writes() == 0:
            _cache_cleanup()
    except OSError:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass


def _download_bytes(source_url: str, kind: str) -> bytes:
    cached = _cache_get(kind, source_url)
    if cached is not None:
        return cached

    response = requests.get(source_url, timeout=_request_timeout_seconds())
    response.raise_for_status()
    payload = response.content
    _cache_put(kind, source_url, payload)
    return payload


def _download_image(image_url: str) -> np.ndarray:
    image = Image.open(BytesIO(_download_bytes(image_url, "image"))).convert("RGB")
    return np.array(image)


def _download_pdf(pdf_url: str) -> bytes:
    return _download_bytes(pdf_url, "pdf")


def _pdf_render_dpi() -> int:
    return int(os.getenv("PDF_RENDER_DPI", "150"))


def _pdf_target_width() -> int:
    return int(os.getenv("PDF_TARGET_WIDTH", "1200"))


def _pdf_webp_quality() -> int:
    return int(os.getenv("PDF_WEBP_QUALITY", "85"))


class PdfAnalyzeRequest(BaseModel):
    pdf_url: str


class PdfAnalyzeResponse(BaseModel):
    page_count: int


class PdfProcessRequest(BaseModel):
    pdf_url: str
    upload_urls: list[str]
    start_page: int | None = None
    end_page: int | None = None
    target_width: int | None = None
    webp_quality: int | None = None
    render_dpi: int | None = None


class PdfProcessResult(BaseModel):
    storage_id: str
    width: int
    height: int
    page: int


class PdfProcessResponse(BaseModel):
    results: list[PdfProcessResult]


def _open_pdf_document(pdf_url: str) -> fitz.Document:
    try:
        pdf_bytes = _download_pdf(pdf_url)
    except requests.RequestException as error:
        raise HTTPException(status_code=502, detail=f"Failed to download PDF: {error}") from error

    try:
        return fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as error:  # pragma: no cover - library-specific parse failures
        raise HTTPException(status_code=400, detail="Could not parse PDF") from error


@app.post("/pdf/analyze", response_model=PdfAnalyzeResponse, dependencies=[Depends(_require_api_key)])
def pdf_analyze(payload: PdfAnalyzeRequest) -> PdfAnalyzeResponse:
    document = _open_pdf_document(payload.pdf_url)
    try:
        return PdfAnalyzeResponse(page_count=document.page_count)
    finally:
        document.close()


@app.post("/pdf/process", response_model=PdfProcessResponse, dependencies=[Depends(_require_api_key)])
def pdf_process(payload: PdfProcessRequest) -> PdfProcessResponse:
    if not payload.upload_urls:
        raise HTTPException(status_code=400, detail="upload_urls must be a non-empty array")

    document = _open_pdf_document(payload.pdf_url)
    try:
        page_count = document.page_count
        if page_count == 0:
            return PdfProcessResponse(results=[])

        start_page = payload.start_page or 1
        end_page = payload.end_page or page_count

        if start_page < 1 or end_page < start_page or end_page > page_count:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid page range start_page={start_page} end_page={end_page} for page_count={page_count}",
            )

        expected_pages = end_page - start_page + 1
        if len(payload.upload_urls) < expected_pages:
            raise HTTPException(
                status_code=400,
                detail="upload_urls must contain at least one URL per processed page",
            )

        quality = min(100, max(1, payload.webp_quality or _pdf_webp_quality()))
        dpi = max(72, payload.render_dpi or _pdf_render_dpi())
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        max_width = max(1, payload.target_width or _pdf_target_width())

        results: list[PdfProcessResult] = []

        for idx, page_number in enumerate(range(start_page, end_page + 1)):
            page = document.load_page(page_number - 1)
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            image = Image.open(BytesIO(pix.tobytes("png"))).convert("RGB")

            if image.width > max_width:
                target_height = max(1, int(image.height * (max_width / image.width)))
                image = image.resize((max_width, target_height), Image.Resampling.LANCZOS)

            output = BytesIO()
            image.save(output, format="WEBP", quality=quality, method=6)
            webp_bytes = output.getvalue()

            upload_url = payload.upload_urls[idx]
            try:
                upload_response = requests.post(
                    upload_url,
                    headers={"content-type": "image/webp"},
                    data=webp_bytes,
                    timeout=_request_timeout_seconds(),
                )
                upload_response.raise_for_status()
                upload_json = upload_response.json()
            except requests.RequestException as error:
                raise HTTPException(
                    status_code=502,
                    detail=f"Upload failed for page {page_number}: {error}",
                ) from error
            except ValueError as error:
                raise HTTPException(
                    status_code=502,
                    detail=f"Upload returned invalid JSON for page {page_number}",
                ) from error

            storage_id = upload_json.get("storageId")
            if not storage_id:
                raise HTTPException(
                    status_code=502,
                    detail=f"Upload succeeded for page {page_number} but returned no storageId",
                )

            results.append(
                PdfProcessResult(
                    storage_id=storage_id,
                    width=image.width,
                    height=image.height,
                    page=page_number,
                ),
            )

        return PdfProcessResponse(results=results)
    finally:
        document.close()


class WordBox(BaseModel):
    text: str
    bbox: list[float]


class OcrPageRequest(BaseModel):
    publication_id: str
    page_number: int
    image_url: str
    page_width: int | None = None
    page_height: int | None = None


class OcrPageResponse(BaseModel):
    engine: str = "TESSERACT"
    version: str = "5.x"
    word_boxes: list[WordBox]


@app.post("/ocr/page", response_model=OcrPageResponse, dependencies=[Depends(_require_api_key)])
def ocr_page(payload: OcrPageRequest) -> OcrPageResponse:
    image_np = _download_image(payload.image_url)
    data = pytesseract.image_to_data(image_np, output_type=pytesseract.Output.DICT)
    result: list[WordBox] = []
    for i, text in enumerate(data.get("text", [])):
        text = (text or "").strip()
        if not text:
            continue
        left = float(data["left"][i])
        top = float(data["top"][i])
        width = float(data["width"][i])
        height = float(data["height"][i])
        result.append(WordBox(text=text, bbox=[left, top, left + width, top + height]))
    return OcrPageResponse(word_boxes=result)


class Segment(BaseModel):
    bbox: list[float]
    type: str = "ARTICLE"


class SegmentPageRequest(BaseModel):
    publication_id: str
    page_number: int
    image_url: str
    page_width: int
    page_height: int
    word_boxes: list[WordBox] = Field(default_factory=list)


class SegmentPageResponse(BaseModel):
    segments: list[Segment]


@app.post("/segment/page", response_model=SegmentPageResponse, dependencies=[Depends(_require_api_key)])
def segment_page(payload: SegmentPageRequest) -> SegmentPageResponse:
    image = _download_image(payload.image_url)
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, thresh = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 25))
    merged = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(merged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    segments: list[Segment] = []
    min_area = max(12000, (payload.page_width * payload.page_height) // 150)
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        if w * h < min_area:
            continue
        segments.append(Segment(bbox=[float(x), float(y), float(x + w), float(y + h)]))

    if not segments and payload.word_boxes:
        # Fallback: one broad segment around text footprint.
        xs = [w.bbox[0] for w in payload.word_boxes] + [w.bbox[2] for w in payload.word_boxes]
        ys = [w.bbox[1] for w in payload.word_boxes] + [w.bbox[3] for w in payload.word_boxes]
        segments.append(
            Segment(
                bbox=[
                    max(0.0, min(xs) - 20),
                    max(0.0, min(ys) - 20),
                    min(float(payload.page_width), max(xs) + 20),
                    min(float(payload.page_height), max(ys) + 20),
                ],
            ),
        )
    return SegmentPageResponse(segments=segments)


class ClassifyLeadRequest(BaseModel):
    publication_id: str
    page_number: int
    segment_bbox: list[float]
    text: str = ""


class ClassifyLeadResponse(BaseModel):
    is_lead: bool
    confidence: float
    prediction: str
    reasons: list[str] = Field(default_factory=list)


POSITIVE_HINTS = {
    "award",
    "winner",
    "honor",
    "spotlight",
    "featured",
    "returns",
    "announced",
    "recognition",
    "best",
    "top",
}


@app.post("/classify/lead", response_model=ClassifyLeadResponse, dependencies=[Depends(_require_api_key)])
def classify_lead(payload: ClassifyLeadRequest) -> ClassifyLeadResponse:
    text = payload.text.lower()
    hit_count = sum(1 for token in POSITIVE_HINTS if token in text)
    confidence = min(0.95, 0.45 + hit_count * 0.1)
    is_lead = hit_count >= 2 or (hit_count >= 1 and len(text.split()) > 12)
    return ClassifyLeadResponse(
        is_lead=is_lead,
        confidence=confidence if is_lead else max(0.05, 1.0 - confidence),
        prediction="positive" if is_lead else "negative",
        reasons=["keyword-heuristic"],
    )


class EnrichLeadRequest(BaseModel):
    publication_id: str
    page_number: int
    segment_bbox: list[float]
    text: str
    word_boxes: list[WordBox] = Field(default_factory=list)


class NamedEntityBox(BaseModel):
    name: str
    bbox: list[float]


class EnrichLeadResponse(BaseModel):
    article_header: str
    article_header_bbox: list[float] | None = None
    person_names: list[str]
    person_name_boxes: list[NamedEntityBox] = Field(default_factory=list)
    company_names: list[str]
    company_name_boxes: list[NamedEntityBox] = Field(default_factory=list)


def _extract_names(text: str) -> list[str]:
    candidates = re.findall(r"\b[A-Z][a-z]+ [A-Z][a-z]+\b", text)
    deduped: list[str] = []
    for candidate in candidates:
        if candidate not in deduped:
            deduped.append(candidate)
    return deduped[:8]


def _extract_companies(text: str) -> list[str]:
    suffixes = ("Inc", "LLC", "Ltd", "Company", "Co", "Corporation", "Corp", "Labs")
    tokens = re.findall(r"\b[A-Z][A-Za-z0-9&\-. ]{1,40}\b", text)
    companies: list[str] = []
    for token in tokens:
        if any(token.endswith(suffix) for suffix in suffixes) and token not in companies:
            companies.append(token.strip())
    return companies[:8]


def _normalize_token(token: str) -> str:
    return re.sub(r"(^[\W_]+|[\W_]+$)", "", token).lower()


def _find_phrase_bbox(phrase: str, word_boxes: list[WordBox]) -> list[float] | None:
    phrase_tokens = [_normalize_token(token) for token in phrase.split()]
    phrase_tokens = [token for token in phrase_tokens if token]
    if not phrase_tokens:
        return None

    normalized_words = [_normalize_token(word.text) for word in word_boxes]
    for start in range(0, len(normalized_words) - len(phrase_tokens) + 1):
        window = normalized_words[start : start + len(phrase_tokens)]
        if window != phrase_tokens:
            continue

        matched = word_boxes[start : start + len(phrase_tokens)]
        xs1 = [word.bbox[0] for word in matched]
        ys1 = [word.bbox[1] for word in matched]
        xs2 = [word.bbox[2] for word in matched]
        ys2 = [word.bbox[3] for word in matched]
        return [min(xs1), min(ys1), max(xs2), max(ys2)]

    return None


@app.post("/enrich/lead", response_model=EnrichLeadResponse, dependencies=[Depends(_require_api_key)])
def enrich_lead(payload: EnrichLeadRequest) -> EnrichLeadResponse:
    lines = [line.strip() for line in payload.text.splitlines() if line.strip()]
    if lines:
        header = max(lines[:3], key=len)
    else:
        words = payload.text.split()
        header = " ".join(words[:10]) if words else "Untitled lead"
    article_header = header[:180]
    person_names = _extract_names(payload.text)
    company_names = _extract_companies(payload.text)
    article_header_bbox = _find_phrase_bbox(article_header, payload.word_boxes)
    person_name_boxes = [
        NamedEntityBox(name=name, bbox=bbox)
        for name in person_names
        if (bbox := _find_phrase_bbox(name, payload.word_boxes)) is not None
    ]
    company_name_boxes = [
        NamedEntityBox(name=name, bbox=bbox)
        for name in company_names
        if (bbox := _find_phrase_bbox(name, payload.word_boxes)) is not None
    ]

    return EnrichLeadResponse(
        article_header=article_header,
        article_header_bbox=article_header_bbox,
        person_names=person_names,
        person_name_boxes=person_name_boxes,
        company_names=company_names,
        company_name_boxes=company_name_boxes,
    )


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok"}


@app.get("/")
def root() -> dict[str, Any]:
    return {"service": "tgn-python-pipeline", "status": "ok"}
