from datetime import datetime, timezone
import json
from pathlib import Path
import unittest
from uuid import uuid4

from vax_pricing.copilot.retrieval import DocumentRepository


class DocumentRepositoryTests(unittest.TestCase):
    def test_hybrid_retrieval_excludes_accessorials_and_caps_sources(self) -> None:
        Path("tmp").mkdir(exist_ok=True)
        path = Path("tmp") / f"test_copilot_documents_{uuid4().hex}.jsonl"
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        records = [
            {
                "evidence_id": f"doc-{index}",
                "document_title": "Peajes México",
                "chunk_title": f"Ruta nacional {index}",
                "text": "Peaje y carretera para equipo DryVan en México.",
                "source_file": "same-source.md",
                "source_name": "Fuente oficial",
                "source_urls": ["https://example.com"],
                "topics": ["tolls", "road_conditions"],
                "territories": ["mexico"],
                "verified_at": "2026-01-01",
                "expires_at": "2026-12-31",
            }
            for index in range(4)
        ]
        records.extend(
            [
                {
                    "evidence_id": "other-source",
                    "document_title": "Operación México",
                    "chunk_title": "Unidad",
                    "text": "Validar tipo de unidad antes de cotizar.",
                    "source_file": "other.md",
                    "source_name": "VAX",
                    "topics": ["vehicle_compliance"],
                    "territories": ["mexico"],
                    "verified_at": "2026-01-01",
                },
                {
                    "evidence_id": "excluded",
                    "document_title": "Cargo",
                    "chunk_title": "Cargo",
                    "text": "Guía de accesoriales posteriores.",
                    "source_file": "excluded.md",
                    "source_name": "VAX",
                    "topics": ["tolls"],
                    "territories": ["mexico"],
                    "verified_at": "2026-01-01",
                },
            ]
        )
        path.write_text(
            "\n".join(json.dumps(record) for record in records) + "\n",
            encoding="utf-8",
        )
        repository = DocumentRepository(path, max_documents=6, max_per_source=2)
        result = repository.search(
            query="México peaje carretera DryVan",
            division="National",
            equipment="DryVan 53",
            origin="Monterrey",
            destination="México",
            reasons=[],
            at=datetime(2026, 7, 1, tzinfo=timezone.utc),
        )
        self.assertLessEqual(
            sum(
                citation["source"] == "Fuente oficial"
                for citation in result.evidence.values()
            ),
            2,
        )
        self.assertNotIn("excluded", result.evidence)
        self.assertTrue(result.records)


if __name__ == "__main__":
    unittest.main()
