import pytesseract
from fastapi import APIRouter

from app.models import OcrPageRequest, OcrPageResponse, WordBox
from app.services.http import download_image

router = APIRouter()


@router.post("/ocr/page", response_model=OcrPageResponse)
def ocr_page(payload: OcrPageRequest) -> OcrPageResponse:
    image_np = download_image(payload.image_url)
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
