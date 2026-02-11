import logging
import os
from pathlib import Path
import threading
import requests

from fastapi import APIRouter
from fastapi import HTTPException

from app.models import Segment, SegmentPageRequest, SegmentPageResponse
from app.services.http import download_image

router = APIRouter()
logger = logging.getLogger("pipeline.segment")

_predictor_lock = threading.Lock()
_predictor = None
_predictor_error: RuntimeError | None = None


def _segmentor_threshold() -> float:
    raw = os.getenv("SEGMENTOR_CONFIDENCE_THRESHOLD", "0.75").strip()
    try:
        value = float(raw)
    except ValueError:
        value = 0.75
    return max(0.0, min(1.0, value))


def _detectron_score_threshold() -> float:
    raw = os.getenv("SEGMENTOR_SCORE_THRESH_TEST", "0.25").strip()
    try:
        return float(raw)
    except ValueError:
        return 0.25


def _detectron_nms_threshold() -> float:
    raw = os.getenv("SEGMENTOR_NMS_THRESH_TEST", "0.5").strip()
    try:
        return float(raw)
    except ValueError:
        return 0.5


def _segmentor_model_weights_path() -> Path:
    model_dir = os.getenv("SEGMENTOR_MODEL_DIR", "").strip()
    if not model_dir:
        raise RuntimeError("Missing SEGMENTOR_MODEL_DIR environment variable")

    model_key = os.getenv("SEGMENTOR_MODEL_KEY", "base").strip() or "base"
    weights = Path(model_dir) / f"{model_key}.pth"
    return weights


def _segmentor_model_url() -> str | None:
    value = os.getenv("SEGMENTOR_MODEL_URL", "").strip()
    return value or None


def _segmentor_model_url_marker_path(weights_path: Path) -> Path:
    return weights_path.with_suffix(".source_url.txt")


def _download_model_weights(weights_path: Path, source_url: str) -> None:
    weights_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = weights_path.with_suffix(".download.tmp")
    try:
        with requests.get(source_url, stream=True, timeout=300) as response:
            response.raise_for_status()
            with temp_path.open("wb") as out:
                for chunk in response.iter_content(chunk_size=8 * 1024 * 1024):
                    if not chunk:
                        continue
                    out.write(chunk)
        temp_path.replace(weights_path)
    finally:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)


def _ensure_model_weights_ready(weights_path: Path) -> None:
    model_url = _segmentor_model_url()
    marker_path = _segmentor_model_url_marker_path(weights_path)

    existing_url = marker_path.read_text().strip() if marker_path.exists() else None
    has_weights = weights_path.exists()
    url_changed = bool(model_url) and existing_url != model_url

    if url_changed and has_weights:
        logger.info(
            "[pipeline/segment] segmentor model URL changed, removing existing weights at %s",
            str(weights_path),
        )
        weights_path.unlink(missing_ok=True)
        marker_path.unlink(missing_ok=True)
        has_weights = False

    if not has_weights:
        if not model_url:
            raise RuntimeError(
                f"Segmentor weights not found at {weights_path} and SEGMENTOR_MODEL_URL is not set"
            )
        logger.info(
            "[pipeline/segment] downloading segmentor weights from SEGMENTOR_MODEL_URL to %s",
            str(weights_path),
        )
        _download_model_weights(weights_path, model_url)
        marker_path.write_text(model_url)
        has_weights = True

    if not has_weights:
        raise RuntimeError(f"Segmentor weights not found at {weights_path}")


def _create_predictor():
    try:
        import torch
        from detectron2.config import get_cfg
        from detectron2.data import MetadataCatalog
        from detectron2.engine import DefaultPredictor
        from detectron2.model_zoo import model_zoo
    except Exception as error:  # pragma: no cover - runtime dependency check
        raise RuntimeError(
            "Missing segmentor dependencies. Install torch and detectron2."
        ) from error

    weights_path = _segmentor_model_weights_path()
    _ensure_model_weights_ready(weights_path)
    classes = ["newspaper-ad", "article"]

    MetadataCatalog.get("articles").set(thing_classes=classes)
    cfg = get_cfg()
    base_model = "COCO-Detection/faster_rcnn_R_50_FPN_1x.yaml"
    cfg.merge_from_file(model_zoo.get_config_file(base_model))
    cfg.MODEL.WEIGHTS = str(weights_path)
    cfg.MODEL.MASK_ON = False
    cfg.INPUT.RANDOM_FLIP = "none"
    cfg.OUTPUT_DIR = "output"
    cfg.MODEL.ROI_HEADS.NUM_CLASSES = len(classes)
    cfg.MODEL.ROI_HEADS.IOU_THRESHOLDS = [0.5]
    cfg.MODEL.ROI_HEADS.BATCH_SIZE_PER_IMAGE = 256
    cfg.MODEL.ROI_HEADS.SCORE_THRESH_TEST = _detectron_score_threshold()
    cfg.MODEL.ROI_HEADS.NMS_THRESH_TEST = _detectron_nms_threshold()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    cfg.MODEL.DEVICE = device
    logger.info(
        "[pipeline/segment] detectron initialized weights=%s device=%s score_thresh=%s nms_thresh=%s",
        str(weights_path),
        device,
        cfg.MODEL.ROI_HEADS.SCORE_THRESH_TEST,
        cfg.MODEL.ROI_HEADS.NMS_THRESH_TEST,
    )
    return DefaultPredictor(cfg)


def _get_predictor():
    global _predictor, _predictor_error
    if _predictor is not None:
        return _predictor
    if _predictor_error is not None:
        raise _predictor_error

    with _predictor_lock:
        if _predictor is not None:
            return _predictor
        if _predictor_error is not None:
            raise _predictor_error
        try:
            _predictor = _create_predictor()
            return _predictor
        except RuntimeError as error:
            _predictor_error = error
            raise


@router.post("/segment/page", response_model=SegmentPageResponse)
def segment_page(payload: SegmentPageRequest) -> SegmentPageResponse:
    try:
        predictor = _get_predictor()
    except RuntimeError as error:
        logger.error("[pipeline/segment] segmentor unavailable: %s", str(error))
        raise HTTPException(status_code=500, detail=str(error)) from error

    image = download_image(payload.image_url)
    model_output = predictor(image)
    instances = model_output["instances"].to("cpu")

    threshold = _segmentor_threshold()
    confident_predictions = instances[instances.scores > threshold]
    pred_boxes = [list(map(float, box)) for box in confident_predictions.get("pred_boxes").tensor.tolist()]

    segments: list[Segment] = []
    for x1, y1, x2, y2 in pred_boxes:
        segments.append(Segment(bbox=[x1, y1, x2, y2]))

    skip_reason = None if segments else "no_detections_above_confidence_threshold"

    logger.info(
        "[pipeline/segment] publication_id=%s page_number=%s total_detections=%s confidence_threshold=%s segments=%s skip_reason=%s",
        payload.publication_id,
        payload.page_number,
        len(instances),
        threshold,
        len(segments),
        skip_reason,
    )
    return SegmentPageResponse(
        segments=segments,
        total_contours=len(instances),
        filtered_small_contours=0,
        min_area=0,
        fallback_used=False,
        skip_reason=skip_reason,
    )
