import json
from pathlib import Path

import pytest

from invariant_data.docile import export_jsonl, iter_split, summarize

FIXTURE = Path(__file__).parent / "fixtures" / "docile"


def test_reads_every_document_listed_in_the_split_index():
    docs = list(iter_split(FIXTURE, "trainval"))
    assert [d.id for d in docs] == ["docile:inv-labeled", "docile:inv-unlabeled"]


def test_maps_metadata_and_keeps_field_text_verbatim():
    doc = next(iter_split(FIXTURE, "trainval"))
    assert doc.source == "docile"
    assert doc.split == "trainval"
    assert doc.labeled is True
    assert doc.document_type == "tax_invoice"
    assert doc.language == "eng"
    assert doc.page_count == 1
    assert doc.pdf_path == "pdfs/inv-labeled.pdf"
    total = next(f for f in doc.fields if f.type == "amount_total_gross")
    # Raw text is kept as printed; parsing "1,210.00" is the extractor's job.
    assert total.text == "1,210.00"
    assert total.bbox == (0.75, 0.80, 0.90, 0.82)


def test_groups_line_item_fields_by_line_in_order():
    doc = next(iter_split(FIXTURE, "trainval"))
    assert [li.id for li in doc.line_items] == [1, 2]
    first = doc.line_items[0]
    assert [(f.type, f.text) for f in first.fields] == [
        ("line_item_description", "Monitor"),
        ("line_item_quantity", "2"),
        ("line_item_amount_gross", "1,000.00"),
    ]


def test_unlabeled_documents_have_metadata_but_no_fields():
    doc = list(iter_split(FIXTURE, "trainval"))[1]
    assert doc.labeled is False
    assert doc.page_count == 2
    assert doc.document_type is None
    assert doc.fields == []
    assert doc.line_items == []


def test_export_writes_one_camel_case_json_object_per_line(tmp_path):
    out = tmp_path / "docile-trainval.jsonl"
    count = export_jsonl(FIXTURE, "trainval", out)

    lines = out.read_text().splitlines()
    assert count == 2
    assert len(lines) == 2
    first = json.loads(lines[0])
    assert first["id"] == "docile:inv-labeled"
    assert first["pageCount"] == 1
    assert first["lineItems"][0]["fields"][0]["text"] == "Monitor"


def test_summary_counts_documents_and_field_types():
    summary = summarize(iter_split(FIXTURE, "trainval"))
    assert summary["documents"] == 2
    assert summary["labeled"] == 1
    assert summary["document_types"] == {"tax_invoice": 1, "unknown": 1}
    assert summary["field_types"]["amount_total_gross"] == 1
    assert summary["line_item_field_types"]["line_item_amount_gross"] == 2
    assert summary["avg_line_items"] == pytest.approx(1.0)


def test_missing_split_index_fails_with_a_clear_message():
    with pytest.raises(FileNotFoundError, match="nope.json"):
        list(iter_split(FIXTURE, "nope"))
