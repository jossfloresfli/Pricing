from __future__ import annotations

import math
import re
import unicodedata
from collections.abc import Mapping
from datetime import date, datetime

import pandas as pd


MISSING = "__MISSING__"
ROUTE_TYPE_BY_DIVISION = {
    "national": "national",
    "crossborder": "crossborder",
    "domestic": "domestic",
    "port freight": "port_freight",
}


def normalize_key(value: object) -> str:
    """Replica la normalización usada para construir las categorías de entrenamiento."""
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return ""
    text = re.sub(r"\s+", " ", str(value).strip().lower())
    text = unicodedata.normalize("NFKD", text)
    text = "".join(character for character in text if not unicodedata.combining(character))
    text = re.sub(r"[^a-z0-9\s,./#-]", "", text)
    return re.sub(r"\s+", " ", text).strip()


# Sufijos de país que agrega Google Maps y que no existen en las claves de entrenamiento.
_COUNTRY_SUFFIXES = {"mexico", "estados unidos", "ee. uu.", "ee.uu.", "eeuu", "usa", "us", "united states", "canada"}

# Abreviaturas de estados (formato Google) hacia los nombres completos usados en el
# historial de entrenamiento. La clave se busca sin puntos ni espacios.
_STATE_BY_ABBREVIATION = {
    # México
    "ags": "aguascalientes", "bc": "baja california", "bcs": "baja california sur",
    "camp": "campeche", "chis": "chiapas", "chih": "chihuahua",
    "coah": "coahuila de zaragoza", "coahuila": "coahuila de zaragoza",
    "col": "colima", "cdmx": "ciudad de mexico", "df": "ciudad de mexico",
    "dgo": "durango", "gto": "guanajuato", "gro": "guerrero", "hgo": "hidalgo",
    "jal": "jalisco", "mex": "estado de mexico", "edomex": "estado de mexico",
    "edodemex": "estado de mexico", "mich": "michoacan de ocampo",
    "michoacan": "michoacan de ocampo", "mor": "morelos", "nay": "nayarit",
    "nl": "nuevo leon", "oax": "oaxaca", "pue": "puebla", "qro": "queretaro",
    "qr": "quintana roo", "qroo": "quintana roo", "slp": "san luis potosi",
    "sin": "sinaloa", "son": "sonora", "tab": "tabasco", "tamps": "tamaulipas",
    "tlax": "tlaxcala", "ver": "veracruz de ignacio de la llave",
    "veracruz": "veracruz de ignacio de la llave", "yuc": "yucatan", "zac": "zacatecas",
    # Estados Unidos (dos letras)
    "al": "alabama", "ak": "alaska", "az": "arizona", "ar": "arkansas",
    "ca": "california", "co": "colorado", "ct": "connecticut", "de": "delaware",
    "fl": "florida", "ga": "georgia", "hi": "hawaii", "id": "idaho",
    "il": "illinois", "in": "indiana", "ia": "iowa", "ks": "kansas",
    "ky": "kentucky", "la": "louisiana", "me": "maine", "md": "maryland",
    "ma": "massachusetts", "mi": "michigan", "mn": "minnesota", "ms": "mississippi",
    "mo": "missouri", "mt": "montana", "ne": "nebraska", "nv": "nevada",
    "nh": "new hampshire", "nj": "new jersey", "nm": "new mexico", "ny": "new york",
    "nc": "north carolina", "nd": "north dakota", "oh": "ohio", "ok": "oklahoma",
    "or": "oregon", "pa": "pennsylvania", "ri": "rhode island", "sc": "south carolina",
    "sd": "south dakota", "tn": "tennessee", "tx": "texas", "ut": "utah",
    "vt": "vermont", "va": "virginia", "wa": "washington", "wv": "west virginia",
    "wi": "wisconsin", "wy": "wyoming",
}


def canonicalize_location(value: object) -> str:
    """Lleva ubicaciones en formato Google Maps al formato del historial de entrenamiento.

    "Tonalá, Jal., México" -> "tonala, jalisco". Si el formato ya coincide con el
    de entrenamiento (p. ej. "guadalajara, jalisco"), se conserva sin cambios.
    """
    normalized = normalize_key(value)
    if not normalized:
        return ""
    segments = [segment.strip() for segment in normalized.split(",") if segment.strip()]
    if len(segments) >= 2 and segments[-1].strip(".") in {s.strip(".") for s in _COUNTRY_SUFFIXES}:
        segments = segments[:-1]
    if len(segments) >= 2:
        lookup = re.sub(r"[.\s]", "", segments[-1])
        expanded = _STATE_BY_ABBREVIATION.get(lookup)
        if expanded is not None:
            segments[-1] = expanded
    # Las claves de entrenamiento son "ciudad, estado": si Google agrega calle o
    # colonia al inicio, se conservan solo los dos últimos segmentos.
    if len(segments) > 2:
        segments = segments[-2:]
    return ", ".join(segments)


def _category(value: object) -> str:
    return normalize_key(value) or MISSING


def _first(record: Mapping[str, object], *names: str) -> object:
    for name in names:
        if name in record:
            return record[name]
    return None


def _created_timestamp(record: Mapping[str, object], created_at: object | None) -> pd.Timestamp:
    value = created_at if created_at is not None else _first(
        record, "FECHA CREACIÓN", "FECHA CREACION", "created_at", "quote_created_at"
    )
    if value is None or value == "":
        return pd.Timestamp.now()
    if isinstance(value, (datetime, date, pd.Timestamp)):
        timestamp = pd.Timestamp(value)
    else:
        timestamp = pd.to_datetime(value, dayfirst=True, errors="coerce")
    if pd.isna(timestamp):
        raise ValueError(f"Fecha de creación inválida: {value!r}")
    return timestamp


def _distance(
    record: Mapping[str, object],
    distance_km: float | None,
    route_cache: object | None,
    origin: object,
    destination: object,
) -> float | None:
    value = distance_km if distance_km is not None else _first(
        record, "google_distance_km", "distance_km"
    )
    if value is None and route_cache is not None:
        value = route_cache.lookup_distance_km(origin, destination)
    numeric = pd.to_numeric(value, errors="coerce")
    if pd.isna(numeric) or not math.isfinite(float(numeric)):
        return None
    if float(numeric) < 0:
        raise ValueError("La distancia no puede ser negativa.")
    return float(numeric)


def prepare_quote(
    record: Mapping[str, object],
    *,
    created_at: object | None = None,
    distance_km: float | None = None,
    route_cache: object | None = None,
) -> dict[str, object]:
    """Convierte una fila del sistema origen al contrato exacto del modelo."""
    origin = _first(record, "ORIGEN", "origin", "origin_name")
    destination = _first(record, "DESTINO", "destination", "destination_name")
    equipment = _first(record, "Tipo de Equipo", "tipo_equipo", "equipment")
    if not normalize_key(origin) or not normalize_key(destination) or not normalize_key(equipment):
        raise ValueError("Origen, destino y tipo de equipo son obligatorios.")

    origin_key = canonicalize_location(origin)
    destination_key = canonicalize_location(destination)
    division_key = _category(_first(record, "DIVISION", "division"))
    timestamp = _created_timestamp(record, created_at)
    resolved_distance = _distance(record, distance_km, route_cache, origin, destination)

    return {
        "CLIENTE_key": _category(_first(record, "CLIENTE", "client", "customer")),
        "PROVEEDOR_key": _category(_first(record, "PROVEEDOR", "provider", "carrier")),
        "ORIGEN_key": origin_key,
        "DESTINO_key": destination_key,
        "route_key": f"{origin_key} -> {destination_key}",
        "Tipo de Equipo_key": _category(equipment),
        "DIVISION_key": division_key,
        "RANGO_key": _category(_first(record, "RANGO", "range")),
        "route_type": ROUTE_TYPE_BY_DIVISION.get(division_key, "pendiente_validacion"),
        "mes_creacion": int(timestamp.month),
        "trimestre_creacion": int(timestamp.quarter),
        "dia_semana_creacion": int(timestamp.dayofweek),
        "google_distance_km": resolved_distance,
    }
