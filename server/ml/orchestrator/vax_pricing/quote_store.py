from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from threading import Lock
import time

from vax_pricing.copilot.schemas import PricingResult, QuoteRequest


@dataclass(frozen=True)
class StoredQuote:
    request: QuoteRequest
    pricing: PricingResult
    expires_at: float


class QuoteResultStore:
    """Almacén local acotado para explicar una cotización sin confiar en el cliente."""

    def __init__(self, *, ttl_seconds: int = 3600, max_entries: int = 200) -> None:
        self.ttl_seconds = max(60, int(ttl_seconds))
        self.max_entries = max(1, int(max_entries))
        self._entries: OrderedDict[str, StoredQuote] = OrderedDict()
        self._lock = Lock()

    def put(self, request: QuoteRequest, pricing: PricingResult) -> None:
        now = time.monotonic()
        stored = StoredQuote(
            request=request.model_copy(deep=True),
            pricing=pricing.model_copy(deep=True),
            expires_at=now + self.ttl_seconds,
        )
        with self._lock:
            self._purge_expired(now)
            self._entries.pop(request.quote_id, None)
            self._entries[request.quote_id] = stored
            while len(self._entries) > self.max_entries:
                self._entries.popitem(last=False)

    def get(self, quote_id: str) -> StoredQuote | None:
        now = time.monotonic()
        with self._lock:
            self._purge_expired(now)
            stored = self._entries.get(quote_id)
            if stored is None:
                return None
            self._entries.move_to_end(quote_id)
            return StoredQuote(
                request=stored.request.model_copy(deep=True),
                pricing=stored.pricing.model_copy(deep=True),
                expires_at=stored.expires_at,
            )

    def _purge_expired(self, now: float) -> None:
        expired = [
            quote_id
            for quote_id, stored in self._entries.items()
            if stored.expires_at <= now
        ]
        for quote_id in expired:
            self._entries.pop(quote_id, None)
