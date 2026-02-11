import logging
import time

from fastapi import Depends, FastAPI
from fastapi import Request

from app.dependencies import require_api_key
from app.routes.health import router as health_router
from app.routes.lead import router as lead_router
from app.routes.ocr import router as ocr_router
from app.routes.pdf import router as pdf_router
from app.routes.publication import router as publication_router
from app.routes.segment import router as segment_router


logger = logging.getLogger("pipeline.api")


def create_app() -> FastAPI:
    app = FastAPI(title="TGN Python Pipeline", version="0.1.0")

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        started_at = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            elapsed_ms = (time.perf_counter() - started_at) * 1000
            logger.exception(
                "[pipeline] %s %s failed duration_ms=%.2f",
                request.method,
                request.url.path,
                elapsed_ms,
            )
            raise

        elapsed_ms = (time.perf_counter() - started_at) * 1000
        logger.info(
            "[pipeline] %s %s status=%s duration_ms=%.2f",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )
        return response

    protected_dependencies = [Depends(require_api_key)]
    app.include_router(pdf_router, dependencies=protected_dependencies)
    app.include_router(ocr_router, dependencies=protected_dependencies)
    app.include_router(publication_router, dependencies=protected_dependencies)
    app.include_router(segment_router, dependencies=protected_dependencies)
    app.include_router(lead_router, dependencies=protected_dependencies)
    app.include_router(health_router)

    return app
