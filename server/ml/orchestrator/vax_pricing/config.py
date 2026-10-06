from pathlib import Path


# El paquete vive directamente dentro de server/ml/orchestrator/, por lo que la
# raíz del paquete es el directorio del orquestador (un nivel arriba).
ROOT = Path(__file__).resolve().parents[1]
RAW_DATA = ROOT / "data" / "Loadboard_2025.csv"
PROCESSED_DIR = ROOT / "data" / "processed"
DOCS_DIR = ROOT / "docs"
PLANNING_DIR = DOCS_DIR / "planning"
REPORTS_DIR = DOCS_DIR / "reports"
RAG_INDEX_DIR = ROOT / "rag" / "index"
RAG_DOCS_DIR = ROOT / "rag" / "documents"
RAG_STRUCTURED_DIR = ROOT / "rag" / "structured"
RAG_VECTOR_DIR = ROOT / "rag" / "vectors"
APP_DATA_DIR = ROOT / "app" / "data"

TRAINING_STATUS = "Invoiced"
FREQUENT_ROUTE_MIN_LOADS = 25
LOW_HISTORY_MIN_LOADS = 5
TARGET_MARGIN_PCT = 0.18
MIN_MARGIN_PCT = 0.10
