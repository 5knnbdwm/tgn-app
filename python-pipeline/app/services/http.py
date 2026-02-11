import os
from io import BytesIO

import numpy as np
import requests
from PIL import Image


def request_timeout_seconds() -> int:
    return int(os.getenv("REQUEST_TIMEOUT_SECONDS", "20"))


def download_image(image_url: str) -> np.ndarray:
    response = requests.get(image_url, timeout=request_timeout_seconds())
    response.raise_for_status()
    image = Image.open(BytesIO(response.content)).convert("RGB")
    return np.array(image)


def download_pdf(pdf_url: str) -> bytes:
    response = requests.get(pdf_url, timeout=request_timeout_seconds())
    response.raise_for_status()
    return response.content
