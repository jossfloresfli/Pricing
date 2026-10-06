from __future__ import annotations

import math
import os
from pathlib import Path

import pandas as pd

from .preprocessing import normalize_key


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE_PATH = PACKAGE_ROOT / "data/google_maps_route_cache.csv"

_DB_COLUMNS = (
    "route_key, origin_address, destination_address, google_distance_m, "
    "google_origin_lat, google_origin_lng, google_destination_lat, google_destination_lng, "
    "google_origin_elevation_m, google_destination_elevation_m, api_status, updated_at"
)


class RouteNotFoundError(LookupError):
    """La ruta no existe o no tiene una distancia válida en el caché."""


class RouteCache:
    """Lector de solo consulta.

    Fuente compartida: la tabla `google_maps_route_cache` en Postgres
    (`DATABASE_URL`), que sobrevive reinicios y es común a todas las réplicas.
    El CSV empaquetado queda como respaldo de solo lectura cuando no hay base.
    """

    def __init__(self, path: str | Path = DEFAULT_CACHE_PATH, dsn: str | None = None) -> None:
        self.path = Path(path)
        self.dsn = (dsn if dsn is not None else os.getenv("DATABASE_URL", "")).strip()
        frame = None
        if self.dsn:
            try:
                frame = self._load_frame_from_db()
            except Exception as exc:  # noqa: BLE001 - queremos el respaldo explícito
                print(f"[route_cache] Fallo la carga desde Postgres, usando CSV de respaldo: {exc}")
                self.dsn = ""
        if frame is None:
            frame = self._load_frame_from_csv()
        self._routes = frame.drop_duplicates("route_key", keep="last").set_index("route_key")

    # ------------------------------------------------------------------ carga
    def _connect(self):
        import psycopg

        return psycopg.connect(self.dsn, connect_timeout=5)

    def _load_frame_from_db(self) -> pd.DataFrame:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT {_DB_COLUMNS} FROM google_maps_route_cache "
                    "WHERE api_status = 'OK' AND google_distance_m >= 0"
                )
                rows = cur.fetchall()
                columns = [desc[0] for desc in cur.description]
        frame = pd.DataFrame(rows, columns=columns)
        if frame.empty:
            raise ValueError("La tabla google_maps_route_cache está vacía")
        frame["route_key"] = frame.apply(
            lambda row: self.key(row["origin_address"], row["destination_address"]), axis=1
        )
        frame["google_distance_m"] = pd.to_numeric(frame["google_distance_m"], errors="coerce")
        return frame

    def _load_frame_from_csv(self) -> pd.DataFrame:
        frame = pd.read_csv(self.path, encoding="utf-8-sig", low_memory=False)
        required = {"route_key", "google_distance_m"}
        missing = required.difference(frame.columns)
        if missing:
            raise ValueError("El caché no contiene: " + ", ".join(sorted(missing)))
        frame = frame.copy()
        if {"origin_address", "destination_address"}.issubset(frame.columns):
            frame["route_key"] = frame.apply(
                lambda row: self.key(row["origin_address"], row["destination_address"]), axis=1
            )
        else:
            frame["route_key"] = frame["route_key"].astype(str).map(
                lambda value: self.key(*value.split("->", 1)) if "->" in value else ""
            )
        frame["google_distance_m"] = pd.to_numeric(frame["google_distance_m"], errors="coerce")
        if "api_status" in frame:
            frame = frame[frame["api_status"].fillna("").astype(str).str.upper().eq("OK")]
        return frame

    # ---------------------------------------------------------------- consulta
    @staticmethod
    def key(origin: object, destination: object) -> str:
        return f"{normalize_key(origin)} -> {normalize_key(destination)}"

    def _fetch_row_from_db(self, key: str) -> pd.Series | None:
        """Consulta puntual: otra réplica pudo escribir la ruta tras la carga inicial."""
        if not self.dsn:
            return None
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        f"SELECT {_DB_COLUMNS} FROM google_maps_route_cache "
                        "WHERE route_key = %s AND api_status = 'OK' AND google_distance_m >= 0",
                        (key,),
                    )
                    row = cur.fetchone()
                    if row is None:
                        return None
                    columns = [desc[0] for desc in cur.description]
        except Exception as exc:  # noqa: BLE001
            print(f"[route_cache] Fallo la consulta puntual en Postgres: {exc}")
            return None
        series = pd.Series(dict(zip(columns, row)))
        series["route_key"] = key
        self._routes.loc[key] = series.drop(labels=["route_key"]).reindex(self._routes.columns)
        return series

    def lookup(self, origin: object, destination: object) -> dict[str, object]:
        key = self.key(origin, destination)
        if key in self._routes.index:
            row = self._routes.loc[key]
        else:
            fetched = self._fetch_row_from_db(key)
            if fetched is None:
                raise RouteNotFoundError(f"Ruta no encontrada en caché: {key}")
            row = fetched
        distance_m = float(row["google_distance_m"])
        if not math.isfinite(distance_m) or distance_m < 0:
            raise RouteNotFoundError(f"Ruta sin distancia válida: {key}")
        return {
            "route_key": key,
            "google_distance_km": distance_m / 1000.0,
            "origin_lat": row.get("google_origin_lat"),
            "origin_lng": row.get("google_origin_lng"),
            "destination_lat": row.get("google_destination_lat"),
            "destination_lng": row.get("google_destination_lng"),
            "origin_elevation_m": row.get("google_origin_elevation_m"),
            "destination_elevation_m": row.get("google_destination_elevation_m"),
            "updated_at": row.get("updated_at"),
        }

    def lookup_distance_km(self, origin: object, destination: object) -> float:
        return float(self.lookup(origin, destination)["google_distance_km"])
