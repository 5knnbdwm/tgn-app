from fastapi import Depends, FastAPI

from app.dependencies import require_api_key
from app.routes.health import router as health_router
from app.routes.lead import router as lead_router
from app.routes.ocr import router as ocr_router
from app.routes.pdf import router as pdf_router
from app.routes.publication import router as publication_router
from app.routes.segment import router as segment_router


def create_app() -> FastAPI:
    app = FastAPI(title="TGN Python Pipeline", version="0.1.0")

    protected_dependencies = [Depends(require_api_key)]
    app.include_router(pdf_router, dependencies=protected_dependencies)
    app.include_router(ocr_router, dependencies=protected_dependencies)
    app.include_router(publication_router, dependencies=protected_dependencies)
    app.include_router(segment_router, dependencies=protected_dependencies)
    app.include_router(lead_router, dependencies=protected_dependencies)
    app.include_router(health_router)

    return app
