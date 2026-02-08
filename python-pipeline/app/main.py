import os
import re
from io import BytesIO
from typing import Any

import cv2
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


def _download_image(image_url: str) -> np.ndarray:
    timeout = int(os.getenv("REQUEST_TIMEOUT_SECONDS", "20"))
    response = requests.get(image_url, timeout=timeout)
    response.raise_for_status()
    image = Image.open(BytesIO(response.content)).convert("RGB")
    return np.array(image)


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


class EnrichLeadResponse(BaseModel):
    article_header: str
    person_names: list[str]
    company_names: list[str]


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


@app.post("/enrich/lead", response_model=EnrichLeadResponse, dependencies=[Depends(_require_api_key)])
def enrich_lead(payload: EnrichLeadRequest) -> EnrichLeadResponse:
    lines = [line.strip() for line in payload.text.splitlines() if line.strip()]
    if lines:
        header = max(lines[:3], key=len)
    else:
        words = payload.text.split()
        header = " ".join(words[:10]) if words else "Untitled lead"
    return EnrichLeadResponse(
        article_header=header[:180],
        person_names=_extract_names(payload.text),
        company_names=_extract_companies(payload.text),
    )


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok"}


@app.get("/")
def root() -> dict[str, Any]:
    return {"service": "tgn-python-pipeline", "status": "ok"}
