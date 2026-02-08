# Python Pipeline Service

This service handles OCR, segmentation, lead classification, and lead enrichment for the Convex pipeline.

## Endpoints

- `POST /pdf/analyze`
- `POST /pdf/process`
- `POST /ocr/page`
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
