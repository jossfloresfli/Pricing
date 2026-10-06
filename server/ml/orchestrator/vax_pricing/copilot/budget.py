from __future__ import annotations

from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import sqlite3
from threading import Lock
from uuid import uuid4
import os


class CopilotLimitError(RuntimeError):
    """Base para límites locales que evitan una llamada a OpenAI."""


class InputTokenLimitError(CopilotLimitError):
    """El paquete de evidencia no cabe en el límite local de entrada."""


class BudgetExceededError(CopilotLimitError):
    """La cuota diaria local no permite reservar otra llamada."""


@dataclass(frozen=True)
class BudgetReservation:
    reservation_id: str
    reserved_tokens: int


class UsageBudget:
    """Cuota diaria persistente y conservadora, separada por usuario."""

    def __init__(
        self,
        path: Path,
        *,
        daily_token_limit: int,
        daily_request_limit: int,
    ) -> None:
        if daily_token_limit <= 0 or daily_request_limit <= 0:
            raise ValueError("Los límites diarios del copiloto deben ser positivos.")
        self.path = path
        self.daily_token_limit = daily_token_limit
        self.daily_request_limit = daily_request_limit
        self._lock = Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    @staticmethod
    def _usage_day() -> str:
        return datetime.now(timezone.utc).date().isoformat()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS copilot_usage (
                        reservation_id TEXT PRIMARY KEY,
                        usage_day TEXT NOT NULL,
                        subject_hash TEXT NOT NULL,
                        status TEXT NOT NULL,
                        reserved_tokens INTEGER NOT NULL,
                        input_tokens INTEGER NOT NULL DEFAULT 0,
                        output_tokens INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL,
                        settled_at TEXT
                    )
                    """
                )
                columns = {
                    str(row["name"])
                    for row in connection.execute(
                        "PRAGMA table_info(copilot_usage)"
                    ).fetchall()
                }
                if "subject_hash" not in columns:
                    connection.execute(
                        "ALTER TABLE copilot_usage ADD COLUMN subject_hash "
                        "TEXT NOT NULL DEFAULT 'legacy_system'"
                    )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS ix_copilot_usage_day "
                    "ON copilot_usage(usage_day)"
                )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS ix_copilot_usage_day_subject "
                    "ON copilot_usage(usage_day, subject_hash)"
                )

    @staticmethod
    def _subject_hash(subject_key: str) -> str:
        normalized = str(subject_key).strip()
        if not normalized:
            raise ValueError("El identificador estable del usuario es obligatorio.")
        return sha256(normalized.encode("utf-8")).hexdigest()

    @staticmethod
    def _totals(
        connection: sqlite3.Connection,
        day: str,
        subject_hash: str,
    ) -> tuple[int, int]:
        row = connection.execute(
            """
            SELECT
                COUNT(*) AS request_count,
                COALESCE(SUM(
                    CASE
                        WHEN status = 'settled'
                        THEN input_tokens + output_tokens
                        ELSE reserved_tokens
                    END
                ), 0) AS token_count
            FROM copilot_usage
            WHERE usage_day = ? AND subject_hash = ?
            """,
            (day, subject_hash),
        ).fetchone()
        return int(row["request_count"]), int(row["token_count"])

    def reserve(
        self,
        *,
        estimated_input_tokens: int,
        max_output_tokens: int,
        subject_key: str = "system",
    ) -> BudgetReservation:
        if estimated_input_tokens <= 0 or max_output_tokens <= 0:
            raise ValueError("La reservación de tokens debe ser positiva.")
        requested_tokens = estimated_input_tokens + max_output_tokens
        day = self._usage_day()
        subject_hash = self._subject_hash(subject_key)
        with self._lock:
            with closing(self._connect()) as connection:
                with connection:
                    connection.execute("BEGIN IMMEDIATE")
                    request_count, token_count = self._totals(
                        connection, day, subject_hash
                    )
                    if request_count >= self.daily_request_limit:
                        raise BudgetExceededError(
                            "El usuario alcanzó el límite diario de solicitudes "
                            "del copiloto."
                        )
                    if token_count + requested_tokens > self.daily_token_limit:
                        raise BudgetExceededError(
                            "La siguiente explicación excedería el límite diario "
                            "de tokens del usuario."
                        )
                    reservation_id = uuid4().hex
                    connection.execute(
                        """
                        INSERT INTO copilot_usage (
                            reservation_id, usage_day, subject_hash, status,
                            reserved_tokens, created_at
                        ) VALUES (?, ?, ?, 'pending', ?, ?)
                        """,
                        (
                            reservation_id,
                            day,
                            subject_hash,
                            requested_tokens,
                            datetime.now(timezone.utc).isoformat(),
                        ),
                    )
        return BudgetReservation(reservation_id, requested_tokens)

    def settle(
        self, reservation: BudgetReservation, *, input_tokens: int, output_tokens: int
    ) -> None:
        with self._lock:
            with closing(self._connect()) as connection:
                with connection:
                    connection.execute(
                        """
                        UPDATE copilot_usage
                        SET status = 'settled', input_tokens = ?, output_tokens = ?,
                            settled_at = ?
                        WHERE reservation_id = ?
                        """,
                        (
                            max(0, input_tokens),
                            max(0, output_tokens),
                            datetime.now(timezone.utc).isoformat(),
                            reservation.reservation_id,
                        ),
                    )

    def fail(self, reservation: BudgetReservation) -> None:
        # Se conserva toda la reserva: una falla puede haber consumido tokens aunque
        # el cliente no haya recibido una respuesta utilizable.
        with self._lock:
            with closing(self._connect()) as connection:
                with connection:
                    connection.execute(
                        """
                        UPDATE copilot_usage
                        SET status = 'failed', settled_at = ?
                        WHERE reservation_id = ?
                        """,
                        (
                            datetime.now(timezone.utc).isoformat(),
                            reservation.reservation_id,
                        ),
                    )

    def snapshot(self, subject_key: str = "system") -> dict[str, int | str]:
        day = self._usage_day()
        subject_hash = self._subject_hash(subject_key)
        with self._lock:
            with closing(self._connect()) as connection:
                request_count, token_count = self._totals(
                    connection, day, subject_hash
                )
        return {
            "day_utc": day,
            "scope": "per_user",
            "requests_used": request_count,
            "requests_limit": self.daily_request_limit,
            "requests_remaining": max(0, self.daily_request_limit - request_count),
            "tokens_used_or_reserved": token_count,
            "tokens_limit": self.daily_token_limit,
            "tokens_remaining": max(0, self.daily_token_limit - token_count),
        }

class PostgresUsageBudget:
    """Cuota diaria persistente en la base Postgres compartida del proyecto.

    Misma interfaz que UsageBudget, pero el contador es global entre réplicas
    y sobrevive reinicios/reemplazos del sistema de archivos local. Cada uso
    (generación vs. embeddings) se separa con la columna `scope`.
    """

    def __init__(
        self,
        dsn: str,
        *,
        scope: str,
        daily_token_limit: int,
        daily_request_limit: int,
    ) -> None:
        if daily_token_limit <= 0 or daily_request_limit <= 0:
            raise ValueError("Los límites diarios del copiloto deben ser positivos.")
        if not str(scope).strip():
            raise ValueError("El alcance (scope) de la cuota es obligatorio.")
        self.dsn = dsn
        self.scope = str(scope).strip()
        self.daily_token_limit = daily_token_limit
        self.daily_request_limit = daily_request_limit
        self._initialize()

    @staticmethod
    def _usage_day() -> str:
        return datetime.now(timezone.utc).date().isoformat()

    def _connect(self):
        import psycopg

        return psycopg.connect(self.dsn, connect_timeout=5)

    def _initialize(self) -> None:
        # Coincide con la definición de `copilot_usage` en shared/schema.ts;
        # el IF NOT EXISTS permite arrancar aunque aún no se haya hecho db:push.
        with closing(self._connect()) as connection:
            with connection:
                with connection.cursor() as cur:
                    cur.execute(
                        """
                        CREATE TABLE IF NOT EXISTS copilot_usage (
                            reservation_id TEXT PRIMARY KEY,
                            scope TEXT NOT NULL DEFAULT 'generation',
                            usage_day TEXT NOT NULL,
                            subject_hash TEXT NOT NULL,
                            status TEXT NOT NULL,
                            reserved_tokens INTEGER NOT NULL,
                            input_tokens INTEGER NOT NULL DEFAULT 0,
                            output_tokens INTEGER NOT NULL DEFAULT 0,
                            created_at TEXT NOT NULL,
                            settled_at TEXT
                        )
                        """
                    )
                    cur.execute(
                        "CREATE INDEX IF NOT EXISTS ix_copilot_usage_scope_day_subject "
                        "ON copilot_usage(scope, usage_day, subject_hash)"
                    )

    _subject_hash = staticmethod(UsageBudget._subject_hash)

    def _totals(self, cur, day: str, subject_hash: str) -> tuple[int, int]:
        cur.execute(
            """
            SELECT
                COUNT(*) AS request_count,
                COALESCE(SUM(
                    CASE
                        WHEN status = 'settled'
                        THEN input_tokens + output_tokens
                        ELSE reserved_tokens
                    END
                ), 0) AS token_count
            FROM copilot_usage
            WHERE scope = %s AND usage_day = %s AND subject_hash = %s
            """,
            (self.scope, day, subject_hash),
        )
        row = cur.fetchone()
        return int(row[0]), int(row[1])

    def reserve(
        self,
        *,
        estimated_input_tokens: int,
        max_output_tokens: int,
        subject_key: str = "system",
    ) -> BudgetReservation:
        if estimated_input_tokens <= 0 or max_output_tokens <= 0:
            raise ValueError("La reservación de tokens debe ser positiva.")
        requested_tokens = estimated_input_tokens + max_output_tokens
        day = self._usage_day()
        subject_hash = self._subject_hash(subject_key)
        with closing(self._connect()) as connection:
            with connection:
                with connection.cursor() as cur:
                    # Serializa reservaciones concurrentes del mismo usuario/día
                    # sin bloquear a otros usuarios.
                    cur.execute(
                        "SELECT pg_advisory_xact_lock(hashtext(%s))",
                        (f"copilot_usage:{self.scope}:{day}:{subject_hash}",),
                    )
                    request_count, token_count = self._totals(cur, day, subject_hash)
                    if request_count >= self.daily_request_limit:
                        raise BudgetExceededError(
                            "El usuario alcanzó el límite diario de solicitudes "
                            "del copiloto."
                        )
                    if token_count + requested_tokens > self.daily_token_limit:
                        raise BudgetExceededError(
                            "La siguiente explicación excedería el límite diario "
                            "de tokens del usuario."
                        )
                    reservation_id = uuid4().hex
                    cur.execute(
                        """
                        INSERT INTO copilot_usage (
                            reservation_id, scope, usage_day, subject_hash, status,
                            reserved_tokens, created_at
                        ) VALUES (%s, %s, %s, %s, 'pending', %s, %s)
                        """,
                        (
                            reservation_id,
                            self.scope,
                            day,
                            subject_hash,
                            requested_tokens,
                            datetime.now(timezone.utc).isoformat(),
                        ),
                    )
        return BudgetReservation(reservation_id, requested_tokens)

    def settle(
        self, reservation: BudgetReservation, *, input_tokens: int, output_tokens: int
    ) -> None:
        with closing(self._connect()) as connection:
            with connection:
                with connection.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE copilot_usage
                        SET status = 'settled', input_tokens = %s, output_tokens = %s,
                            settled_at = %s
                        WHERE reservation_id = %s
                        """,
                        (
                            max(0, input_tokens),
                            max(0, output_tokens),
                            datetime.now(timezone.utc).isoformat(),
                            reservation.reservation_id,
                        ),
                    )

    def fail(self, reservation: BudgetReservation) -> None:
        # Se conserva toda la reserva: una falla puede haber consumido tokens aunque
        # el cliente no haya recibido una respuesta utilizable.
        with closing(self._connect()) as connection:
            with connection:
                with connection.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE copilot_usage
                        SET status = 'failed', settled_at = %s
                        WHERE reservation_id = %s
                        """,
                        (
                            datetime.now(timezone.utc).isoformat(),
                            reservation.reservation_id,
                        ),
                    )

    def snapshot(self, subject_key: str = "system") -> dict[str, int | str]:
        day = self._usage_day()
        subject_hash = self._subject_hash(subject_key)
        with closing(self._connect()) as connection:
            with connection.cursor() as cur:
                request_count, token_count = self._totals(cur, day, subject_hash)
        return {
            "day_utc": day,
            "scope": "per_user",
            "requests_used": request_count,
            "requests_limit": self.daily_request_limit,
            "requests_remaining": max(0, self.daily_request_limit - request_count),
            "tokens_used_or_reserved": token_count,
            "tokens_limit": self.daily_token_limit,
            "tokens_remaining": max(0, self.daily_token_limit - token_count),
        }

def create_usage_budget(
    *,
    sqlite_path: Path,
    scope: str,
    daily_token_limit: int,
    daily_request_limit: int,
) -> "UsageBudget | PostgresUsageBudget":
    """Usa la base Postgres compartida cuando está configurada; de lo contrario
    conserva el respaldo SQLite local (desarrollo de un solo proceso)."""
    dsn = os.getenv("DATABASE_URL", "").strip()
    if dsn:
        return PostgresUsageBudget(
            dsn,
            scope=scope,
            daily_token_limit=daily_token_limit,
            daily_request_limit=daily_request_limit,
        )
    return UsageBudget(
        sqlite_path,
        daily_token_limit=daily_token_limit,
        daily_request_limit=daily_request_limit,
    )
