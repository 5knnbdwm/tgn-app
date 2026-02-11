import cv2
from fastapi import APIRouter

from app.models import Segment, SegmentPageRequest, SegmentPageResponse
from app.services.http import download_image

router = APIRouter()


@router.post("/segment/page", response_model=SegmentPageResponse)
def segment_page(payload: SegmentPageRequest) -> SegmentPageResponse:
    image = download_image(payload.image_url)
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
