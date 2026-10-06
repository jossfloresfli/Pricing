"""Verifica la detección de desfase de la capa derivada regional."""

from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path
import tempfile
import unittest

from vax_pricing.copilot.regional import assignments_status, corpus_fingerprint


class RegionalAssignmentsFreshnessTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.historical = self.dir / "historical_loads.jsonl"
        self.cache = self.dir / "route_cache.csv"
        self.manifest = self.dir / "regional_assignments_manifest.json"
        self.historical.write_text('{"a":1}\n', encoding="utf-8")
        self.cache.write_text("origen,destino\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _write_manifest(self, fingerprint: dict | None) -> None:
        payload: dict = {"schema_version": "test"}
        if fingerprint is not None:
            payload["source_fingerprint"] = fingerprint
        self.manifest.write_text(json.dumps(payload), encoding="utf-8")

    def test_fingerprint_matches_sha256_and_handles_missing_files(self) -> None:
        fp = corpus_fingerprint(self.historical, self.cache)
        self.assertEqual(
            fp["historical_loads_sha256"],
            sha256(self.historical.read_bytes()).hexdigest(),
        )
        fp_missing = corpus_fingerprint(self.dir / "no.jsonl", self.cache)
        self.assertIsNone(fp_missing["historical_loads_sha256"])

    def test_missing_manifest_reports_missing(self) -> None:
        fp = corpus_fingerprint(self.historical, self.cache)
        self.assertEqual(assignments_status(self.manifest, fp), "missing")

    def test_manifest_without_fingerprint_is_stale(self) -> None:
        self._write_manifest(None)
        fp = corpus_fingerprint(self.historical, self.cache)
        self.assertEqual(assignments_status(self.manifest, fp), "stale")

    def test_fresh_when_fingerprints_match(self) -> None:
        fp = corpus_fingerprint(self.historical, self.cache)
        self._write_manifest(fp)
        self.assertEqual(assignments_status(self.manifest, fp), "fresh")

    def test_stale_when_corpus_changes(self) -> None:
        fp = corpus_fingerprint(self.historical, self.cache)
        self._write_manifest(fp)
        self.historical.write_text('{"a":1}\n{"b":2}\n', encoding="utf-8")
        fp_new = corpus_fingerprint(self.historical, self.cache)
        self.assertEqual(assignments_status(self.manifest, fp_new), "stale")


if __name__ == "__main__":
    unittest.main()
