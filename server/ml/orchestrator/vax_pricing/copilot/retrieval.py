from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import unicodedata
from typing import Any, Protocol

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer


EXCLUDED_TERMS = ("accesorial", "accesorios")
RRF_K = 60


def _normalize(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").lower())
    text = "".join(character for character in text if not unicodedata.combining(character))
    return re.sub(r"\s+", " ", text).strip()


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8-sig") as stream:
        for line in stream:
            if line.strip():
                record = json.loads(line)
                if not any(term in _normalize(record.get("text")) for term in EXCLUDED_TERMS):
                    records.append(record)
    return records


class SemanticRanker(Protocol):
    def rank(self, query: str, *, limit: int) -> list[str]: ...


@dataclass
class DocumentRetrieval:
    records: list[dict[str, Any]]
    evidence: dict[str, dict[str, Any]]
    semantic_used: bool


class DocumentRepository:
    """Recuperación híbrida local con RRF y semántica opcional."""

    def __init__(
        self,
        path: Path,
        *,
        semantic_ranker: SemanticRanker | None = None,
        max_documents: int = 6,
        max_per_source: int = 2,
    ) -> None:
        if not path.exists():
            raise FileNotFoundError(f"No existe el corpus documental: {path}")
        self._records = _read_jsonl(path)
        if not self._records:
            raise ValueError("El corpus documental está vacío.")
        self._semantic_ranker = semantic_ranker
        self.max_documents = max_documents
        self.max_per_source = max_per_source
        corpus = [
            " ".join(
                [
                    str(record.get("document_title") or ""),
                    str(record.get("chunk_title") or ""),
                    str(record.get("text") or ""),
                    " ".join(record.get("topics") or []),
                    " ".join(record.get("territories") or []),
                ]
            )
            for record in self._records
        ]
        self._word_vectorizer = TfidfVectorizer(
            strip_accents="unicode",
            lowercase=True,
            ngram_range=(1, 2),
            sublinear_tf=True,
            min_df=1,
        )
        self._char_vectorizer = TfidfVectorizer(
            strip_accents="unicode",
            lowercase=True,
            analyzer="char_wb",
            ngram_range=(3, 5),
            sublinear_tf=True,
            min_df=1,
        )
        self._word_matrix = self._word_vectorizer.fit_transform(corpus)
        self._char_matrix = self._char_vectorizer.fit_transform(corpus)
        self._by_id = {
            str(record["evidence_id"]): record for record in self._records
        }

    @property
    def record_count(self) -> int:
        return len(self._records)

    @property
    def semantic_available(self) -> bool:
        return self._semantic_ranker is not None

    @property
    def semantic_budget_snapshot(self) -> dict[str, Any] | None:
        budget = getattr(self._semantic_ranker, "budget", None)
        return budget.snapshot() if budget is not None else None

    @staticmethod
    def _rank_scores(scores: np.ndarray, limit: int = 40) -> list[str]:
        indices = np.argsort(-scores, kind="stable")
        return [str(index) for index in indices[:limit] if scores[index] > 0]

    def _text_rankings(self, query: str) -> tuple[list[str], list[str]]:
        word_query = self._word_vectorizer.transform([query])
        char_query = self._char_vectorizer.transform([query])
        word_scores = (self._word_matrix @ word_query.T).toarray().ravel()
        char_scores = (self._char_matrix @ char_query.T).toarray().ravel()
        return self._rank_scores(word_scores), self._rank_scores(char_scores)

    def _metadata_ranking(
        self,
        *,
        division: str,
        equipment: str,
        origin: str,
        destination: str,
        reasons: list[str],
    ) -> list[str]:
        query_terms = set(
            re.findall(
                r"[a-z0-9]+",
                _normalize(
                    " ".join([division, equipment, origin, destination, *reasons])
                ),
            )
        )
        ranked: list[tuple[int, str]] = []
        for index, record in enumerate(self._records):
            metadata = _normalize(
                " ".join(
                    [
                        *record.get("topics", []),
                        *record.get("territories", []),
                        str(record.get("document_title") or ""),
                        str(record.get("chunk_title") or ""),
                    ]
                )
            )
            metadata_terms = set(re.findall(r"[a-z0-9]+", metadata))
            score = len(query_terms & metadata_terms)
            if score:
                ranked.append((score, str(index)))
        ranked.sort(key=lambda item: (-item[0], int(item[1])))
        return [index for _, index in ranked[:40]]

    @staticmethod
    def _is_stale(record: dict[str, Any], at: datetime) -> bool:
        expires_at = record.get("expires_at")
        if not expires_at:
            return False
        try:
            expiry = datetime.fromisoformat(str(expires_at))
        except ValueError:
            return bool(record.get("is_stale_at_build"))
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        comparison = at.replace(tzinfo=timezone.utc) if at.tzinfo is None else at
        return expiry < comparison

    @staticmethod
    def _citation_type(record: dict[str, Any]) -> str:
        source = _normalize(record.get("source_file"))
        topics = set(record.get("topics") or [])
        if "capufe_tarifas" in source or (
            source.endswith(".pdf") and "tolls" in topics
        ):
            return "toll_rate"
        if "model_policy" in topics or "contract" in source or "router" in source:
            return "policy"
        return "document"

    def search(
        self,
        *,
        query: str,
        division: str,
        equipment: str,
        origin: str,
        destination: str,
        reasons: list[str],
        at: datetime,
    ) -> DocumentRetrieval:
        word_ranking, char_ranking = self._text_rankings(query)
        metadata_ranking = self._metadata_ranking(
            division=division,
            equipment=equipment,
            origin=origin,
            destination=destination,
            reasons=reasons,
        )
        rankings = [word_ranking, char_ranking, metadata_ranking]
        semantic_used = False
        if self._semantic_ranker is not None:
            try:
                semantic_ids = self._semantic_ranker.rank(query, limit=40)
            except Exception:
                semantic_ids = []
            semantic_ranking = [
                str(index)
                for index, record in enumerate(self._records)
                if str(record["evidence_id"]) in set(semantic_ids)
            ]
            semantic_ranking.sort(
                key=lambda index: semantic_ids.index(
                    str(self._records[int(index)]["evidence_id"])
                )
            )
            if semantic_ranking:
                rankings.append(semantic_ranking)
                semantic_used = True

        fused: defaultdict[str, float] = defaultdict(float)
        for ranking in rankings:
            for position, index in enumerate(ranking, start=1):
                fused[index] += 1.0 / (RRF_K + position)
        ordered = sorted(fused, key=lambda index: (-fused[index], int(index)))

        selected: list[dict[str, Any]] = []
        source_counts: defaultdict[str, int] = defaultdict(int)
        for index in ordered:
            record = self._records[int(index)]
            source_file = str(record.get("source_file") or record.get("source_name") or "")
            if source_counts[source_file] >= self.max_per_source:
                continue
            selected.append(record)
            source_counts[source_file] += 1
            if len(selected) >= self.max_documents:
                break

        evidence: dict[str, dict[str, Any]] = {}
        prompt_records: list[dict[str, Any]] = []
        for record in selected:
            evidence_id = str(record["evidence_id"])
            is_stale = self._is_stale(record, at)
            source_urls = record.get("source_urls") or []
            citation = {
                "evidence_id": evidence_id,
                "type": self._citation_type(record),
                "title": str(
                    record.get("chunk_title")
                    or record.get("document_title")
                    or "Documento"
                ),
                "source": str(record.get("source_name") or record.get("source_file") or ""),
                "excerpt": str(record.get("text") or "")[:500],
                "url": source_urls[0] if source_urls else None,
                "verified_at": record.get("verified_at"),
                "is_stale": is_stale,
            }
            evidence[evidence_id] = citation
            prompt_records.append(
                {
                    "evidence_id": evidence_id,
                    "title": citation["title"],
                    "source": citation["source"],
                    "verified_at": citation["verified_at"],
                    "is_stale": is_stale,
                    "topics": record.get("topics") or [],
                    "territories": record.get("territories") or [],
                    "text": str(record.get("text") or ""),
                }
            )
        return DocumentRetrieval(
            records=prompt_records,
            evidence=evidence,
            semantic_used=semantic_used,
        )
