import os
import re
import json
from io import BytesIO
from typing import Any

import cv2
import fitz
import numpy as np
import pytesseract
import requests
from fastapi import Depends, FastAPI, Header, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

app = FastAPI(title="TGN Python Pipeline", version="0.1.0")


def _require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    expected = os.getenv("PIPELINE_API_KEY", "").strip()
    if expected and x_api_key != expected:
        raise HTTPException(status_code=401, detail="Invalid API key")


def _request_timeout_seconds() -> int:
    return int(os.getenv("REQUEST_TIMEOUT_SECONDS", "20"))


def _download_image(image_url: str) -> np.ndarray:
    response = requests.get(image_url, timeout=_request_timeout_seconds())
    response.raise_for_status()
    image = Image.open(BytesIO(response.content)).convert("RGB")
    return np.array(image)


def _download_pdf(pdf_url: str) -> bytes:
    response = requests.get(pdf_url, timeout=_request_timeout_seconds())
    response.raise_for_status()
    return response.content


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


class UploadTarget(BaseModel):
    key: str
    url: str


class PdfProcessRequest(BaseModel):
    pdf_url: str
    uploads: list[UploadTarget]
    start_page: int | None = None
    end_page: int | None = None
    target_width: int | None = None
    webp_quality: int | None = None
    render_dpi: int | None = None


class PdfProcessResult(BaseModel):
    storage_key: str
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
    if not payload.uploads:
        raise HTTPException(status_code=400, detail="uploads must be a non-empty array")

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
        if len(payload.uploads) < expected_pages:
            raise HTTPException(
                status_code=400,
                detail="uploads must contain at least one URL/key pair per processed page",
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

            upload = payload.uploads[idx]
            upload_url = upload.url
            storage_key = upload.key
            try:
                upload_response = requests.put(
                    upload_url,
                    headers={"content-type": "image/webp"},
                    data=webp_bytes,
                    timeout=_request_timeout_seconds(),
                )
                upload_response.raise_for_status()
            except requests.RequestException as error:
                raise HTTPException(
                    status_code=502,
                    detail=f"Upload failed for page {page_number}: {error}",
                ) from error

            results.append(
                PdfProcessResult(
                    storage_key=storage_key,
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


class PublicationMetadataPage(BaseModel):
    page_number: int
    page_width: int | None = None
    page_height: int | None = None
    word_boxes: list[WordBox] = Field(default_factory=list)


class PublicationMetadataRequest(BaseModel):
    pages: list[PublicationMetadataPage] = Field(default_factory=list)
    fallback_name: str | None = None


class PublicationMetadataResponse(BaseModel):
    publication_name: str | None = None
    publication_date: str | None = None


UUID_LIKE_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
MONTH_DATE_RE = re.compile(
    r"\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|"
    r"dec(?:ember)?)\b[^.\n]{0,30}\b\d{4}\b",
    re.IGNORECASE,
)
NUMERIC_DATE_RE = re.compile(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b")


def _normalize_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _strip_file_extension(name: str) -> str:
    return re.sub(r"\.[^./\\]+$", "", name).strip()


def _looks_cryptic_name(name: str) -> bool:
    candidate = _strip_file_extension(name)
    if not candidate:
        return True

    compact = re.sub(r"[\s_\-.]", "", candidate)
    if not compact:
        return True
    if UUID_LIKE_RE.match(candidate):
        return True
    if re.fullmatch(r"[0-9a-fA-F]{20,}", compact):
        return True
    if re.fullmatch(r"\d{8,}", compact):
        return True

    alpha_count = sum(1 for ch in compact if ch.isalpha())
    digit_count = sum(1 for ch in compact if ch.isdigit())
    if alpha_count < 4 and digit_count >= 6:
        return True

    return False


def _prettify_fallback_name(name: str | None) -> str | None:
    if not name:
        return None
    cleaned = _normalize_spaces(_strip_file_extension(name).replace("_", " ").replace("-", " "))
    if not cleaned:
        return None
    if cleaned.isupper():
        return cleaned.title()
    return cleaned


def _group_word_boxes_into_lines(word_boxes: list[WordBox]) -> list[tuple[float, str]]:
    ordered = [
        word
        for word in sorted(word_boxes, key=lambda item: (item.bbox[1], item.bbox[0]))
        if len(word.bbox) == 4 and _normalize_spaces(word.text)
    ]
    if not ordered:
        return []

    lines: list[dict[str, Any]] = []
    for word in ordered:
        y_center = (word.bbox[1] + word.bbox[3]) / 2
        matched = None
        for line in lines:
            if abs(y_center - line["y"]) <= 12:
                matched = line
                break
        if matched is None:
            matched = {"y": y_center, "count": 0, "words": []}
            lines.append(matched)
        matched["count"] += 1
        matched["y"] = (matched["y"] * (matched["count"] - 1) + y_center) / matched["count"]
        matched["words"].append(word)

    grouped_lines: list[tuple[float, str]] = []
    for line in lines:
        words = sorted(line["words"], key=lambda item: item.bbox[0])
        text = _normalize_spaces(" ".join(word.text for word in words))
        if text:
            grouped_lines.append((line["y"], text))

    return sorted(grouped_lines, key=lambda item: item[0])


def _score_publication_name_candidate(text: str) -> float:
    value = _normalize_spaces(text).strip(" |-_")
    if len(value) < 3 or len(value) > 80:
        return -1.0

    words = value.split()
    if len(words) > 12:
        return -1.0

    alpha_chars = sum(1 for ch in value if ch.isalpha())
    if alpha_chars < 3:
        return -1.0

    digit_chars = sum(1 for ch in value if ch.isdigit())
    if digit_chars > alpha_chars:
        return -1.0

    upper_chars = sum(1 for ch in value if ch.isupper())
    letter_chars = sum(1 for ch in value if ch.isalpha())
    uppercase_ratio = (upper_chars / letter_chars) if letter_chars else 0.0

    lowered = value.lower()
    if lowered.startswith("page ") or lowered.startswith("www.") or "http" in lowered:
        return -1.0

    score = 1.0
    score += min(1.2, len(words) * 0.12)
    score += uppercase_ratio * 0.7
    if any(ch in value for ch in ("&", "|")):
        score += 0.1
    return score


def _extract_publication_name_from_pages(pages: list[PublicationMetadataPage]) -> str | None:
    candidates: list[tuple[float, str]] = []
    sorted_pages = sorted(pages, key=lambda item: item.page_number)
    for page_index, page in enumerate(sorted_pages):
        lines = _group_word_boxes_into_lines(page.word_boxes)
        if not lines:
            continue

        top_limit = (page.page_height * 0.3) if page.page_height else None
        for y_pos, line_text in lines[:24]:
            if top_limit is not None and y_pos > top_limit:
                continue
            score = _score_publication_name_candidate(line_text)
            if score <= 0:
                continue
            # Earlier pages are stronger signals for masthead detection.
            score += max(0.0, 0.35 - page_index * 0.15)
            candidates.append((score, line_text))

    if not candidates:
        return None

    best = max(candidates, key=lambda item: item[0])[1]
    return _normalize_spaces(best).strip(" |-_")


def _extract_publication_name_with_score(pages: list[PublicationMetadataPage]) -> tuple[str | None, float]:
    candidates: list[tuple[float, str]] = []
    sorted_pages = sorted(pages, key=lambda item: item.page_number)
    for page_index, page in enumerate(sorted_pages):
        lines = _group_word_boxes_into_lines(page.word_boxes)
        if not lines:
            continue

        top_limit = (page.page_height * 0.3) if page.page_height else None
        for y_pos, line_text in lines[:24]:
            if top_limit is not None and y_pos > top_limit:
                continue
            score = _score_publication_name_candidate(line_text)
            if score <= 0:
                continue
            score += max(0.0, 0.35 - page_index * 0.15)
            candidates.append((score, _normalize_spaces(line_text).strip(" |-_")))

    if not candidates:
        return None, 0.0

    best_score, best_name = max(candidates, key=lambda item: item[0])
    return best_name, best_score


def _extract_publication_date_from_pages(pages: list[PublicationMetadataPage]) -> str | None:
    sorted_pages = sorted(pages, key=lambda item: item.page_number)
    for page in sorted_pages[:2]:
        line_text = " ".join(text for _, text in _group_word_boxes_into_lines(page.word_boxes)[:30])
        month_match = MONTH_DATE_RE.search(line_text)
        if month_match:
            return _normalize_spaces(month_match.group(0))
        numeric_match = NUMERIC_DATE_RE.search(line_text)
        if numeric_match:
            return numeric_match.group(0)
    return None


def _openrouter_timeout_seconds() -> int:
    return int(os.getenv("OPENROUTER_TIMEOUT_SECONDS", "15"))


def _openrouter_config() -> tuple[str | None, str]:
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip() or None
    model = os.getenv("OPENROUTER_MODEL", "qwen/qwen2.5-7b-instruct").strip()
    return api_key, model


def _strip_code_fence(value: str) -> str:
    text = value.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z0-9_-]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    return text.strip()


def _build_llm_page_digest(pages: list[PublicationMetadataPage]) -> str:
    digest_blocks: list[str] = []
    sorted_pages = sorted(pages, key=lambda item: item.page_number)
    for page in sorted_pages[:2]:
        lines = _group_word_boxes_into_lines(page.word_boxes)[:35]
        if not lines:
            continue
        text_lines = [f"- y={int(y)} text={line}" for y, line in lines]
        digest_blocks.append(f"Page {page.page_number}\n" + "\n".join(text_lines))
    return "\n\n".join(digest_blocks)


def _extract_publication_metadata_with_llm(
    pages: list[PublicationMetadataPage],
    fallback_name: str | None,
) -> tuple[str | None, str | None]:
    api_key, model = _openrouter_config()
    if not api_key:
        return None, None

    digest = _build_llm_page_digest(pages)
    if not digest:
        return None, None

    system_prompt = (
        "You extract publication metadata from OCR lines.\n"
        "Return ONLY compact JSON with keys: publication_name, publication_date, confidence.\n"
        "publication_name must be null when uncertain.\n"
        "publication_date must be null when uncertain.\n"
        "confidence is a number from 0 to 1."
    )
    user_prompt = (
        f"Fallback filename: {fallback_name or 'null'}\n\n"
        "OCR lines from first pages:\n"
        f"{digest}\n\n"
        "Rules:\n"
        "- Prefer masthead/publication title, not article titles.\n"
        "- If title seems unavailable, return null.\n"
        "- If date is unavailable, return null.\n"
        "- No extra keys, no prose."
    )

    try:
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0,
                "response_format": {"type": "json_object"},
            },
            timeout=_openrouter_timeout_seconds(),
        )
        response.raise_for_status()
        data = response.json()
        content = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        parsed = json.loads(_strip_code_fence(content))
        confidence = parsed.get("confidence", 0)
        try:
            confidence_num = float(confidence)
        except (TypeError, ValueError):
            confidence_num = 0.0

        publication_name = parsed.get("publication_name")
        publication_date = parsed.get("publication_date")
        if isinstance(publication_name, str):
            publication_name = _normalize_spaces(publication_name)
        else:
            publication_name = None
        if isinstance(publication_date, str):
            publication_date = _normalize_spaces(publication_date)
        else:
            publication_date = None

        if confidence_num < 0.6:
            return None, None
        return publication_name or None, publication_date or None
    except Exception:
        return None, None


@app.post(
    "/publication/metadata",
    response_model=PublicationMetadataResponse,
    dependencies=[Depends(_require_api_key)],
)
def publication_metadata(payload: PublicationMetadataRequest) -> PublicationMetadataResponse:
    extracted_name, name_score = _extract_publication_name_with_score(payload.pages)
    publication_date = _extract_publication_date_from_pages(payload.pages)
    should_try_llm = (
        extracted_name is None
        or _looks_cryptic_name(extracted_name)
        or name_score < 1.85
        or publication_date is None
    )
    llm_name: str | None = None
    llm_date: str | None = None
    if should_try_llm:
        llm_name, llm_date = _extract_publication_metadata_with_llm(
            payload.pages,
            payload.fallback_name,
        )

    if llm_name and not _looks_cryptic_name(llm_name):
        publication_name = llm_name
    elif extracted_name:
        publication_name = extracted_name
    else:
        fallback_name = _prettify_fallback_name(payload.fallback_name)
        if fallback_name and not _looks_cryptic_name(fallback_name):
            publication_name = fallback_name
        else:
            publication_name = None

    if llm_date:
        publication_date = llm_date

    return PublicationMetadataResponse(
        publication_name=publication_name,
        publication_date=publication_date,
    )


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
