from pydantic import BaseModel, Field


class PdfAnalyzeRequest(BaseModel):
    pdf_url: str


class PdfAnalyzeResponse(BaseModel):
    page_count: int


class UploadTarget(BaseModel):
    key: str
    url: str


class PdfProcessRequest(BaseModel):
    pdf_url: str
    uploads: list[UploadTarget]
    start_page: int | None = None
    end_page: int | None = None
    target_width: int | None = None
    webp_quality: int | None = None
    render_dpi: int | None = None


class PdfProcessResult(BaseModel):
    storage_key: str
    width: int
    height: int
    page: int


class PdfProcessResponse(BaseModel):
    results: list[PdfProcessResult]


class WordBox(BaseModel):
    text: str
    bbox: list[float]


class OcrPageRequest(BaseModel):
    publication_id: str
    page_number: int
    image_url: str
    page_width: int | None = None
    page_height: int | None = None


class OcrPageResponse(BaseModel):
    engine: str = "TESSERACT"
    version: str = "5.x"
    word_boxes: list[WordBox]


class PublicationMetadataPage(BaseModel):
    page_number: int
    page_width: int | None = None
    page_height: int | None = None
    word_boxes: list[WordBox] = Field(default_factory=list)


class PublicationMetadataRequest(BaseModel):
    pages: list[PublicationMetadataPage] = Field(default_factory=list)
    fallback_name: str | None = None


class PublicationMetadataResponse(BaseModel):
    publication_name: str | None = None
    publication_date: str | None = None


class Segment(BaseModel):
    bbox: list[float]
    type: str = "ARTICLE"


class SegmentPageRequest(BaseModel):
    publication_id: str
    page_number: int
    image_url: str
    page_width: int
    page_height: int
    word_boxes: list[WordBox] = Field(default_factory=list)


class SegmentPageResponse(BaseModel):
    segments: list[Segment]


class ClassifyLeadRequest(BaseModel):
    publication_id: str
    page_number: int
    segment_bbox: list[float]
    text: str = ""


class ClassifyLeadResponse(BaseModel):
    is_lead: bool
    confidence: float
    prediction: str
    reasons: list[str] = Field(default_factory=list)


class EnrichLeadRequest(BaseModel):
    publication_id: str
    page_number: int
    segment_bbox: list[float]
    text: str
    word_boxes: list[WordBox] = Field(default_factory=list)


class NamedEntityBox(BaseModel):
    name: str
    bbox: list[float]


class EnrichLeadResponse(BaseModel):
    article_header: str
    article_header_bbox: list[float] | None = None
    person_names: list[str]
    person_name_boxes: list[NamedEntityBox] = Field(default_factory=list)
    company_names: list[str]
    company_name_boxes: list[NamedEntityBox] = Field(default_factory=list)
