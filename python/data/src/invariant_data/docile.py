"""Loader for the DocILE dataset (https://github.com/rossumai/docile).

Converts DocILE annotations into Invariant's common `LabeledDocument` format.
Field values are kept exactly as printed ("1,210.00", "03/02/2021"): turning
them into cents and ISO dates is what the extractor and the rules are for, so
the loader must not do it silently.
"""

import json
from collections import Counter
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

BBox = tuple[float, float, float, float]


class _Model(BaseModel):
    # JSON uses camelCase, like the TypeScript side; Python keeps snake_case.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)


class Field(_Model):
    type: str
    text: str | None
    page: int
    bbox: BBox  # left, top, right, bottom, relative to the page (0..1)


class LineItem(_Model):
    id: int
    fields: list[Field]


class LabeledDocument(_Model):
    id: str
    source: str
    split: str
    labeled: bool
    pdf_path: str
    page_count: int
    document_type: str | None
    language: str | None
    currency: str | None
    cluster_id: int | None
    fields: list[Field]
    line_items: list[LineItem]


def _field(raw: dict[str, Any]) -> Field:
    return Field(type=raw["fieldtype"], text=raw.get("text"), page=raw["page"], bbox=raw["bbox"])


def _line_items(raw_fields: list[dict[str, Any]]) -> list[LineItem]:
    by_line: dict[int, list[Field]] = {}
    for raw in raw_fields:
        by_line.setdefault(raw["line_item_id"], []).append(_field(raw))
    return [LineItem(id=line_id, fields=fields) for line_id, fields in sorted(by_line.items())]


def load_document(dataset_dir: Path, split: str, doc_id: str) -> LabeledDocument:
    annotation = json.loads((dataset_dir / "annotations" / f"{doc_id}.json").read_text())
    metadata = annotation.get("metadata", {})
    labeled = "field_extractions" in annotation
    return LabeledDocument(
        id=f"docile:{doc_id}",
        source="docile",
        split=split,
        labeled=labeled,
        pdf_path=f"pdfs/{doc_id}.pdf",
        page_count=metadata["page_count"],
        document_type=metadata.get("document_type"),
        language=metadata.get("language"),
        currency=metadata.get("currency"),
        cluster_id=metadata.get("cluster_id"),
        fields=[_field(raw) for raw in annotation.get("field_extractions", [])],
        line_items=_line_items(annotation.get("line_item_extractions", [])),
    )


def iter_split(dataset_dir: Path, split: str) -> Iterator[LabeledDocument]:
    """Yields every document listed in `<dataset_dir>/<split>.json`, one at a time."""
    index = dataset_dir / f"{split}.json"
    if not index.exists():
        raise FileNotFoundError(f"Split index not found: {index}")
    for doc_id in json.loads(index.read_text()):
        yield load_document(dataset_dir, split, doc_id)


def export_jsonl(dataset_dir: Path, split: str, out: Path) -> int:
    """Writes the split as JSONL (one document per line). Returns the document count."""
    out.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with out.open("w") as f:
        for doc in iter_split(dataset_dir, split):
            f.write(doc.model_dump_json(by_alias=True) + "\n")
            count += 1
    return count


def summarize(docs: Iterable[LabeledDocument]) -> dict[str, Any]:
    """Counts used to explore a split before training on it."""
    documents = labeled = line_items = 0
    document_types: Counter[str] = Counter()
    languages: Counter[str] = Counter()
    field_types: Counter[str] = Counter()
    line_item_field_types: Counter[str] = Counter()
    for doc in docs:
        documents += 1
        labeled += doc.labeled
        line_items += len(doc.line_items)
        document_types[doc.document_type or "unknown"] += 1
        languages[doc.language or "unknown"] += 1
        field_types.update(f.type for f in doc.fields)
        line_item_field_types.update(f.type for li in doc.line_items for f in li.fields)
    return {
        "documents": documents,
        "labeled": labeled,
        "document_types": dict(document_types),
        "languages": dict(languages),
        "field_types": dict(field_types.most_common()),
        "line_item_field_types": dict(line_item_field_types.most_common()),
        "avg_line_items": line_items / documents if documents else 0.0,
    }
