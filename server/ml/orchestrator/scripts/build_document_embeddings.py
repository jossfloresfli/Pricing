from __future__ import annotations

import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import sys

import numpy as np
from dotenv import load_dotenv
from openai import OpenAI


# El paquete canónico vax_pricing vive directamente en la raíz del orquestador
# (no en src/, que contiene un paquete antiguo incompleto).
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from vax_pricing.config import RAG_STRUCTURED_DIR, RAG_VECTOR_DIR  # noqa: E402
from vax_pricing.copilot.token_limits import count_tokens  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Genera offline los embeddings del corpus documental aprobado."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=RAG_STRUCTURED_DIR / "document_chunks.jsonl",
    )
    parser.add_argument("--output-dir", type=Path, default=RAG_VECTOR_DIR)
    parser.add_argument(
        "--model",
        default="text-embedding-3-small",
    )
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument(
        "--max-records",
        type=int,
        default=500,
        help="Abortar antes de llamar a OpenAI si el corpus supera este número.",
    )
    parser.add_argument(
        "--max-total-tokens",
        type=int,
        default=150000,
        help="Presupuesto máximo de tokens de entrada para esta construcción.",
    )
    return parser.parse_args()


def read_records(path: Path) -> list[dict[str, object]]:
    records = []
    with path.open("r", encoding="utf-8-sig") as stream:
        for line in stream:
            if line.strip():
                record = json.loads(line)
                text = str(record.get("text") or "")
                if "accesorial" not in text.lower() and "accesorios" not in text.lower():
                    records.append(record)
    return records


def main() -> None:
    args = parse_args()
    load_dotenv(ROOT / ".env", override=False)
    records = read_records(args.input.resolve())
    if not records:
        raise SystemExit("No hay documentos elegibles para generar embeddings.")
    if len(records) > args.max_records:
        raise SystemExit(
            f"Se canceló antes de llamar a OpenAI: {len(records)} documentos "
            f"superan el límite de {args.max_records}."
        )
    token_count = sum(
        count_tokens(str(record["text"]), args.model) for record in records
    )
    if token_count > args.max_total_tokens:
        raise SystemExit(
            f"Se canceló antes de llamar a OpenAI: {token_count} tokens estimados "
            f"superan el límite de {args.max_total_tokens}."
        )
    client = OpenAI(max_retries=0, timeout=30)
    vectors: list[list[float]] = []
    for start in range(0, len(records), args.batch_size):
        batch = records[start : start + args.batch_size]
        response = client.embeddings.create(
            model=args.model,
            input=[str(record["text"]) for record in batch],
        )
        vectors.extend(item.embedding for item in response.data)

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    vectors_path = output_dir / "document_embeddings.npz"
    metadata_path = output_dir / "document_embeddings.json"
    matrix = np.asarray(vectors, dtype=np.float32)
    np.savez_compressed(vectors_path, vectors=matrix)
    metadata = {
        "model": args.model,
        "built_at": datetime.now(timezone.utc).isoformat(),
        "source_path": args.input.resolve().as_posix(),
        "source_sha256": sha256(args.input.read_bytes()).hexdigest(),
        "count": len(records),
        "estimated_input_tokens": token_count,
        "dimensions": int(matrix.shape[1]),
        "evidence_ids": [str(record["evidence_id"]) for record in records],
    }
    metadata_path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    manifest_path = RAG_STRUCTURED_DIR / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
        manifest["embedding_status"] = "generated"
        manifest["embeddings"] = {
            "model": args.model,
            "count": len(records),
            "estimated_input_tokens": token_count,
            "vectors_path": vectors_path.as_posix(),
            "metadata_path": metadata_path.as_posix(),
        }
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    print(
        json.dumps(
            {
                "status": "ok",
                "model": args.model,
                "count": len(records),
                "estimated_input_tokens": token_count,
                "vectors_path": vectors_path.as_posix(),
                "metadata_path": metadata_path.as_posix(),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
