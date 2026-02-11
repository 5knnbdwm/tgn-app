from io import BytesIO
import os

import fitz
import requests
from fastapi import APIRouter, HTTPException
from PIL import Image

from app.models import PdfAnalyzeRequest, PdfAnalyzeResponse, PdfProcessRequest, PdfProcessResponse, PdfProcessResult
from app.services.http import download_pdf, request_timeout_seconds

router = APIRouter()


def _pdf_render_dpi() -> int:
    return int(os.getenv("PDF_RENDER_DPI", "150"))


def _pdf_target_width() -> int:
    return int(os.getenv("PDF_TARGET_WIDTH", "1200"))


def _pdf_webp_quality() -> int:
    return int(os.getenv("PDF_WEBP_QUALITY", "85"))


def _open_pdf_document(pdf_url: str) -> fitz.Document:
    try:
        pdf_bytes = download_pdf(pdf_url)
    except requests.RequestException as error:
        raise HTTPException(status_code=502, detail=f"Failed to download PDF: {error}") from error

    try:
        return fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as error:  # pragma: no cover - library-specific parse failures
        raise HTTPException(status_code=400, detail="Could not parse PDF") from error


@router.post("/pdf/analyze", response_model=PdfAnalyzeResponse)
def pdf_analyze(payload: PdfAnalyzeRequest) -> PdfAnalyzeResponse:
    document = _open_pdf_document(payload.pdf_url)
    try:
        return PdfAnalyzeResponse(page_count=document.page_count)
    finally:
        document.close()


@router.post("/pdf/process", response_model=PdfProcessResponse)
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
            try:
                upload_response = requests.put(
                    upload.url,
                    headers={"content-type": "image/webp"},
                    data=webp_bytes,
                    timeout=request_timeout_seconds(),
                )
                upload_response.raise_for_status()
            except requests.RequestException as error:
                raise HTTPException(
                    status_code=502,
                    detail=f"Upload failed for page {page_number}: {error}",
                ) from error

            results.append(
                PdfProcessResult(
                    storage_key=upload.key,
                    width=image.width,
                    height=image.height,
                    page=page_number,
                ),
            )

        return PdfProcessResponse(results=results)
    finally:
        document.close()
