import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from protected_cost import ProtectedCostService
from protected_cost.route_cache import RouteNotFoundError

PORT = int(os.environ.get("ORCHESTRATOR_PORT", "8100"))

# --- Copiloto explicador (capa opcional; nunca bloquea la cotización) ---
# IMPORTANTE: el copiloto se importa ANTES de crear ProtectedCostService porque
# la inicialización del orquestador antepone src/ a sys.path, cuyo paquete
# vax_pricing antiguo (sólo trip_duration) opacaría al paquete completo. Al
# importar primero, sys.modules queda cacheado con el paquete canónico
# (orchestrator/vax_pricing), que también incluye trip_duration.
copilot_service = None
copilot_init_error = None
try:
    from vax_pricing.copilot.schemas import PricingResult, QuoteRequest
    from vax_pricing.copilot.service import PriceCopilotService

    copilot_service = PriceCopilotService.from_settings()
    sys.stderr.write("[orchestrator] copiloto inicializado\n")
except Exception as exc:  # noqa: BLE001
    copilot_init_error = str(exc)
    sys.stderr.write(f"[orchestrator] copiloto no disponible: {exc}\n")

service = ProtectedCostService()


def sanitize(obj):
    import math

    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [sanitize(v) for v in obj]
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if hasattr(obj, "item"):
        try:
            return sanitize(obj.item())
        except Exception:
            return str(obj)
    if isinstance(obj, (str, int, bool)) or obj is None:
        return obj
    return str(obj)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("[orchestrator] %s\n" % (fmt % args))

    def _send(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            copilot_health = None
            if copilot_service is not None:
                try:
                    copilot_health = copilot_service.health()
                except Exception as exc:  # noqa: BLE001
                    copilot_health = {"available": False, "error": str(exc)}
            elif copilot_init_error:
                copilot_health = {"available": False, "error": copilot_init_error}
            self._send(200, {"status": "ok", "copilot": sanitize(copilot_health)})
        else:
            self._send(404, {"error": "not_found"})

    def _handle_copilot_explain(self):
        if copilot_service is None:
            self._send(503, {
                "error": "copilot_unavailable",
                "detail": copilot_init_error or "copiloto no inicializado",
            })
            return
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        budget_subject = payload.get("budget_subject")
        if not budget_subject or not isinstance(budget_subject, str):
            self._send(400, {"error": "budget_subject_requerido"})
            return
        try:
            quote_request = QuoteRequest.model_validate(payload.get("quote_request") or {})
            pricing_result = PricingResult.model_validate(payload.get("pricing_result") or {})
        except Exception as exc:  # noqa: BLE001
            self._send(400, {"error": "contrato_invalido", "detail": str(exc)})
            return
        response = copilot_service.explain(
            quote_request,
            pricing_result,
            budget_subject=budget_subject,
        )
        self._send(200, sanitize(json.loads(response.model_dump_json())))

    def do_POST(self):
        if self.path == "/copilot/explain":
            try:
                self._handle_copilot_explain()
            except Exception as exc:  # noqa: BLE001
                traceback.print_exc()
                self._send(500, {"error": "copilot_failed", "detail": str(exc)})
            return
        if self.path != "/predict":
            self._send(404, {"error": "not_found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            raw_quote = payload.get("quote") or {}
            created_at = payload.get("created_at")
            distance_km = payload.get("distance_km")
            geo = payload.get("geo")
            kwargs = {}
            if created_at is not None:
                kwargs["created_at"] = created_at
            if distance_km is not None:
                kwargs["distance_km"] = float(distance_km)
            if geo is not None:
                kwargs["geo"] = geo
            result = service.predict(raw_quote, **kwargs)
            self._send(200, sanitize(result))
        except RouteNotFoundError:
            self._send(422, {"error": "route_not_in_cache"})
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            self._send(500, {"error": "prediction_failed", "detail": str(exc)})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    sys.stderr.write(f"[orchestrator] listening on 127.0.0.1:{PORT}\n")
    server.serve_forever()
