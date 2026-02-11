import json
import os
import re
from typing import Any

import requests
from fastapi import APIRouter

from app.models import PublicationMetadataPage, PublicationMetadataRequest, PublicationMetadataResponse, WordBox

router = APIRouter()

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
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
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


@router.post("/publication/metadata", response_model=PublicationMetadataResponse)
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
        llm_name, llm_date = _extract_publication_metadata_with_llm(payload.pages, payload.fallback_name)

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

    return PublicationMetadataResponse(publication_name=publication_name, publication_date=publication_date)
