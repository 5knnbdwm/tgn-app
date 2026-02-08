FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libtesseract-dev \
    && rm -rf /var/lib/apt/lists/*

COPY . /src
RUN set -eux; \
    if [ -f /src/requirements.txt ] && [ -d /src/app ]; then \
      cp /src/requirements.txt /app/requirements.txt; \
      cp -R /src/app /app/app; \
    elif [ -f /src/python-pipeline/requirements.txt ] && [ -d /src/python-pipeline/app ]; then \
      cp /src/python-pipeline/requirements.txt /app/requirements.txt; \
      cp -R /src/python-pipeline/app /app/app; \
    else \
      echo "Could not find requirements.txt and app directory in build context"; \
      exit 1; \
    fi; \
    pip install -r /app/requirements.txt; \
    rm -rf /src

EXPOSE 8080

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
