import re
import json
import os

from fastapi import APIRouter
import requests

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


def _normalize_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _openrouter_timeout_seconds() -> int:
    return int(os.getenv("OPENROUTER_TIMEOUT_SECONDS", "15"))


def _openrouter_config() -> tuple[str | None, str | None]:
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip() or None
    model = os.getenv("OPENROUTER_MODEL", "").strip() or None
    return api_key, model


def _strip_code_fence(value: str) -> str:
    text = value.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z0-9_-]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    return text.strip()


def _call_openrouter_json(system_prompt: str, user_prompt: str) -> dict | None:
    api_key, model = _openrouter_config()
    if not api_key or not model:
        return None

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
        payload = response.json()
        content = (
            payload.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        parsed = json.loads(_strip_code_fence(content))
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def _classify_lead_with_llm(text: str) -> tuple[bool, float, str] | None:
    clean_text = _normalize_spaces(text)
    if not clean_text:
        return None

    system_prompt = (
        "You classify article text for a newspaper lead-generation workflow.\n"
        "Return ONLY JSON: is_lead (boolean), confidence (0..1), reason (short string)."
    )
    user_prompt = (
        "Classify whether this contains a positive achievement-style article about a person "
        "or company milestone.\n"
        "Prefer false if this looks like generic news, sports coverage, event announcements, "
        "ads/promotions, or weak/unclear context.\n\n"
        f"ARTICLE_TEXT:\n{clean_text[:12000]}"
    )
    parsed = _call_openrouter_json(system_prompt, user_prompt)
    if not parsed:
        return None

    is_lead = parsed.get("is_lead")
    confidence = parsed.get("confidence")
    reason = parsed.get("reason", "llm-classifier")
    if not isinstance(is_lead, bool):
        return None
    try:
        confidence_num = float(confidence)
    except (TypeError, ValueError):
        confidence_num = 0.5
    confidence_num = max(0.0, min(1.0, confidence_num))
    reason_text = reason if isinstance(reason, str) else "llm-classifier"
    return is_lead, confidence_num, _normalize_spaces(reason_text)[:120]


def _enrich_lead_with_llm(text: str) -> tuple[str, list[str], list[str]] | None:
    clean_text = text.strip()
    if not clean_text:
        return None

    system_prompt = (
        "Extract structured lead info from article text.\n"
        "Return ONLY JSON keys: article_header (string), person_names (array of strings), "
        "company_names (array of strings)."
    )
    user_prompt = (
        "Rules:\n"
        "- article_header should be the best concise article headline-like phrase.\n"
        "- person_names should include only real person names found in text.\n"
        "- company_names should include only organization/company names found in text.\n"
        "- Do not invent entities.\n\n"
        f"ARTICLE_TEXT:\n{clean_text[:12000]}"
    )
    parsed = _call_openrouter_json(system_prompt, user_prompt)
    if not parsed:
        return None

    article_header = parsed.get("article_header")
    person_names = parsed.get("person_names")
    company_names = parsed.get("company_names")
    if not isinstance(article_header, str):
        return None
    if not isinstance(person_names, list) or not isinstance(company_names, list):
        return None

    normalized_header = _normalize_spaces(article_header)[:180]
    normalized_people = [
        _normalize_spaces(str(name))
        for name in person_names
        if isinstance(name, str) and _normalize_spaces(name)
    ]
    normalized_companies = [
        _normalize_spaces(str(name))
        for name in company_names
        if isinstance(name, str) and _normalize_spaces(name)
    ]

    dedup_people: list[str] = []
    for name in normalized_people:
        if name.lower() in ("none", "n/a"):
            continue
        if name not in dedup_people:
            dedup_people.append(name)

    dedup_companies: list[str] = []
    for name in normalized_companies:
        if name.lower() in ("none", "n/a"):
            continue
        if name not in dedup_companies:
            dedup_companies.append(name)

    return normalized_header, dedup_people[:8], dedup_companies[:8]


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
    llm_result = _classify_lead_with_llm(payload.text)
    if llm_result is not None:
        is_lead, confidence, reason = llm_result
        return ClassifyLeadResponse(
            is_lead=is_lead,
            confidence=confidence,
            prediction="positive" if is_lead else "negative",
            reasons=[f"llm:{reason}"],
        )

    text = payload.text.lower()
    hit_count = sum(1 for token in POSITIVE_HINTS if token in text)
    confidence = min(0.95, 0.45 + hit_count * 0.1)
    is_lead = hit_count >= 2 or (hit_count >= 1 and len(text.split()) > 12)
    return ClassifyLeadResponse(
        is_lead=is_lead,
        confidence=confidence if is_lead else max(0.05, 1.0 - confidence),
        prediction="positive" if is_lead else "negative",
        reasons=["keyword-heuristic-fallback"],
    )


@router.post("/enrich/lead", response_model=EnrichLeadResponse)
def enrich_lead(payload: EnrichLeadRequest) -> EnrichLeadResponse:
    llm_enrichment = _enrich_lead_with_llm(payload.text)
    if llm_enrichment is not None:
        article_header, person_names, company_names = llm_enrichment
    else:
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
