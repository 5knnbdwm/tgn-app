# Python Pipeline Service

This service handles OCR, segmentation, lead classification, and lead enrichment for the Convex pipeline.

## Endpoints

- `POST /pdf/analyze`
- `POST /pdf/process`
- `POST /ocr/page`
- `POST /publication/metadata`
- `POST /segment/page`
- `POST /classify/lead`
- `POST /enrich/lead`
- `GET /health`

## Run locally

```bash
cd python-pipeline
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install 'git+https://github.com/facebookresearch/detectron2.git'
cp .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
```

## Docker

```bash
docker build -t tgn-python-pipeline .
docker run --rm -p 8080:8080 --env-file .env tgn-python-pipeline
```

## Auth

If `PIPELINE_API_KEY` is set, requests must include header:

`x-api-key: <PIPELINE_API_KEY>`

## Optional LLM Fallback (OpenRouter)

Publication metadata extraction can use an OpenRouter model as fallback when
heuristics are low confidence.

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` (used by `/classify/lead`, `/enrich/lead`, `/publication/metadata`)
- `OPENROUTER_TIMEOUT_SECONDS` (default: `15`)

## Segmentor Model Configuration

Segmentation uses Detectron2 model inference (no OpenCV fallback path).
If model dependencies or weights are missing, `/segment/page` returns `500`.

- `SEGMENTOR_MODEL_DIR` (directory containing `<SEGMENTOR_MODEL_KEY>.pth`)
- `SEGMENTOR_MODEL_KEY` (default: `base`)
- `SEGMENTOR_MODEL_URL` (optional presigned URL to download/update model file)
- `SEGMENTOR_CONFIDENCE_THRESHOLD` (default: `0.75`)
- `SEGMENTOR_SCORE_THRESH_TEST` (default: `0.25`)
- `SEGMENTOR_NMS_THRESH_TEST` (default: `0.5`)

When `SEGMENTOR_MODEL_URL` is set, the service stores the last used URL in the
volume next to the model file. If the URL changes, the old weights file is
deleted and a fresh file is downloaded before loading the predictor.
