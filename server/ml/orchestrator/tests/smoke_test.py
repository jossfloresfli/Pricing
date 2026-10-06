import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from protected_cost import ProtectedCostService


service = ProtectedCostService()
cached = service.route_cache._routes.iloc[0]
result = service.predict({
    "quote_id": "smoke-quote",
    "quote_row_id": "smoke-row-1",
    "currency": "MXN",
    "ORIGEN": cached["origin_address"],
    "DESTINO": cached["destination_address"],
    "Tipo de Equipo": "Dryvan 53",
    "DIVISION": "National",
    "CLIENTE": None,
    "PROVEEDOR": None,
    "RANGO": None,
}, created_at="21/07/2026")

prediction = result["prediction"]
assert prediction["protected_cost_mxn"] >= prediction["central_prediction_mxn"]
assert result["routing"]["mode"] == "shadow_only"
assert result["routing"]["review_required"] is True
print({
    "central_prediction_mxn": prediction["central_prediction_mxn"],
    "protected_cost_mxn": prediction["protected_cost_mxn"],
    "decision_status": prediction["decision_status"],
    "selected_model": result["routing"]["selected_model"],
})
