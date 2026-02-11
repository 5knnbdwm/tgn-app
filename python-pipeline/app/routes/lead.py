import re
import json
import os
import logging
import time

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
logger = logging.getLogger("pipeline.ai")

LEGACY_LEAD_MIN_TEXT_LENGTH = int(os.getenv("LEAD_MIN_TEXT_LENGTH", "400"))


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


def _call_openrouter_json(operation: str, system_prompt: str, user_prompt: str) -> dict | None:
    api_key, model = _openrouter_config()
    if not api_key or not model:
        logger.info("[pipeline/ai] operation=%s skipped reason=missing_openrouter_config", operation)
        return None

    timeout_seconds = _openrouter_timeout_seconds()
    started_at = time.perf_counter()
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
            timeout=timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        elapsed_ms = (time.perf_counter() - started_at) * 1000
        usage = payload.get("usage", {}) if isinstance(payload, dict) else {}
        prompt_tokens = usage.get("prompt_tokens")
        completion_tokens = usage.get("completion_tokens")
        total_tokens = usage.get("total_tokens")
        logger.info(
            "[pipeline/ai] operation=%s model=%s status=%s duration_ms=%.2f prompt_tokens=%s completion_tokens=%s total_tokens=%s",
            operation,
            model,
            response.status_code,
            elapsed_ms,
            prompt_tokens,
            completion_tokens,
            total_tokens,
        )
        content = (
            payload.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        parsed = json.loads(_strip_code_fence(content))
        return parsed if isinstance(parsed, dict) else None
    except Exception as error:
        elapsed_ms = (time.perf_counter() - started_at) * 1000
        logger.warning(
            "[pipeline/ai] operation=%s model=%s failed duration_ms=%.2f timeout_s=%s error=%s",
            operation,
            model,
            elapsed_ms,
            timeout_seconds,
            str(error),
        )
        return None


def _classify_lead_with_llm(text: str) -> tuple[bool, float, str] | None:
    clean_text = _normalize_spaces(text)
    if not clean_text:
        return None

    if len(clean_text) < LEGACY_LEAD_MIN_TEXT_LENGTH:
        return False, 0.99, "text_too_short_for_full_article"

    system_prompt = (
        "You are a strict newspaper lead classifier for achievement-articles.\n"
        "Return ONLY JSON."
    )
    user_prompt = (
        "Classify OCR text as an achievement-article candidate using the rules below.\n"
        "An achievement-article is a full positive article about a living person or company milestone/"
        "achievement/honor/recognition that someone could plausibly frame and hang on their wall.\n\n"
        "Hard exclusions (if any are true, output must be negative):\n"
        "1) Any sports/athlete/coach/team/league/tournament/score/championship focus.\n"
        "2) Main protagonist under 18.\n"
        "3) Deceased individuals (obituary/memorial/tribute).\n"
        "4) Generic reporting without a clear personal/business milestone.\n"
        "5) Upcoming event announcement.\n"
        "6) Main subject is an international celebrity.\n"
        "7) Ad/promotional copy: pricing/discount/coupon/call/visit/email/phone/url/store-hours/buy prompts.\n"
        "8) Opening/reopening story.\n\n"
        "Return JSON with exactly these keys:\n"
        "- contains_full_achievement_article: boolean\n"
        "- is_sports_related: boolean\n"
        "- is_under_18_protagonist: boolean\n"
        "- is_deceased_story: boolean\n"
        "- is_generic_news_without_milestone: boolean\n"
        "- is_upcoming_event: boolean\n"
        "- is_international_celebrity: boolean\n"
        "- is_advertisement_or_direct_promo: boolean\n"
        "- is_opening_or_reopening_story: boolean\n"
        "- short_reason: string (max 120 chars)\n\n"
        "OCR_TEXT:\n"
        f"{clean_text[:12000]}"
    )
    parsed = _call_openrouter_json("classify_lead", system_prompt, user_prompt)
    if not parsed:
        return None

    contains_full = parsed.get("contains_full_achievement_article")
    if not isinstance(contains_full, bool):
        return None

    exclusion_fields = (
        "is_sports_related",
        "is_under_18_protagonist",
        "is_deceased_story",
        "is_generic_news_without_milestone",
        "is_upcoming_event",
        "is_international_celebrity",
        "is_advertisement_or_direct_promo",
        "is_opening_or_reopening_story",
    )
    exclusions_hit: list[str] = [
        field
        for field in exclusion_fields
        if isinstance(parsed.get(field), bool) and bool(parsed.get(field))
    ]
    is_lead = contains_full and len(exclusions_hit) == 0
    reason = parsed.get("short_reason")
    reason_text = _normalize_spaces(reason)[:120] if isinstance(reason, str) else "achievement-classifier"
    if exclusions_hit:
        reason_text = f"{reason_text}; excludes={','.join(exclusions_hit[:3])}"[:120]

    return is_lead, 0.99, reason_text


def _build_token_font_pairs(word_boxes: list[WordBox]) -> list[list[str | float]]:
    pairs: list[list[str | float]] = []
    for box in word_boxes:
        token = _normalize_spaces(box.text)
        if not token:
            continue
        bbox = box.bbox if len(box.bbox) >= 4 else [0.0, 0.0, 0.0, 0.0]
        font_size = max(0.0, float(bbox[3]) - float(bbox[1]))
        pairs.append([token, round(font_size, 2)])
    return pairs


def _enrich_lead_with_llm(text: str, word_boxes: list[WordBox]) -> tuple[str, list[str], list[str]] | None:
    clean_text = text.strip()
    if not clean_text:
        return None

    token_font_pairs = _build_token_font_pairs(word_boxes)
    token_font_payload = json.dumps(token_font_pairs[:500], ensure_ascii=True)

    system_prompt = "Return ONLY JSON."
    user_prompt = (
        "Extract lead details using the rules below:\n"
        "1) Entity extraction:\n"
        "- Extract person names and company names exactly as written in OCR (keep misspellings/typos).\n"
        "- Do not invent names.\n"
        "- Return arrays; use [] when none.\n\n"
        "2) Headline extraction:\n"
        "- Choose the main headline only.\n"
        "- Use token+font-size pairs as primary evidence (largest font contiguous span + coherence + top-of-page prior).\n"
        "- Preserve token text exactly when possible.\n"
        "- Return the smallest coherent headline span.\n\n"
        "Return JSON with exactly these keys:\n"
        "- article_header: string\n"
        "- person_names: array<string>\n"
        "- company_names: array<string>\n\n"
        f"ARTICLE_TEXT:\n{clean_text[:12000]}\n\n"
        f"COMBINED_TOKENS_AND_FONT_SIZE:\n{token_font_payload}"
    )
    parsed = _call_openrouter_json("enrich_lead", system_prompt, user_prompt)
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

    return ClassifyLeadResponse(
        is_lead=False,
        confidence=0.2,
        prediction="negative",
        reasons=["llm_unavailable_or_parse_failure"],
    )


@router.post("/enrich/lead", response_model=EnrichLeadResponse)
def enrich_lead(payload: EnrichLeadRequest) -> EnrichLeadResponse:
    llm_enrichment = _enrich_lead_with_llm(payload.text, payload.word_boxes)
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
