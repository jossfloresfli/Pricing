---
name: Protected Cost Orchestrator integration
description: How the Python ML orchestrator runs inside the Node app and constraints to respect.
---

- The orchestrator is the shipped Python package run as-is (child process HTTP service on 127.0.0.1:8100), NOT a Node reimplementation. **Why:** README labels Node reimplementation high-risk; policy/guardrails must match training code exactly. **How to apply:** never re-code routing/P67/guardrail logic in TS or the frontend — consume the router output.
- Manifest hash paths are relative to `artifacts/` (e.g. `models/x.onnx` → `artifacts/models/x.onnx`).
- Orchestrator requires a resolvable distance (its own route cache or explicit `distance_km`); it 422s otherwise — that's the intended trigger for the Node base-model fallback.
- Production bundles the server to `dist/index.cjs`, so `import.meta.dirname`-relative asset paths break; resolve with a cwd fallback (`server/ml/...`) and existence check.
- Bash-tool background processes (even nohup) die between tool sessions — long-lived helpers must be spawned by the app itself.
