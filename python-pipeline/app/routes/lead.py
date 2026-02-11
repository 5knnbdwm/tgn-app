import re

from fastapi import APIRouter

from app.models import (
    ClassifyLeadRequest,
    ClassifyLeadResponse,
    EnrichLeadRequest,
    EnrichLeadResponse,
    NamedEntityBox,
    WordBox,
)

router = APIRouter()

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


@router.post("/classify/lead", response_model=ClassifyLeadResponse)
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


@router.post("/enrich/lead", response_model=EnrichLeadResponse)
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
