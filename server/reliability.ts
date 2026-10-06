import type { ErrorRequestHandler, RequestHandler } from "express";
import type { Pool } from "pg";

// Pool errors are emitted for idle clients, outside the scope of any request.
// Never log the error object or the accompanying pg client: either may contain
// connection details, SQL, or credentials.
export function installIdlePoolErrorHandler(pool: Pool): void {
  pool.on("error", (error: Error) => {
    const code = (error as Error & { code?: unknown }).code;
    const safeCode = typeof code === "string" && /^[A-Z0-9][A-Z0-9_]{1,30}$/.test(code)
      ? ` (${code})`
      : "";
    console.error(`[database] Idle PostgreSQL client error${safeCode}; pool will replace the client`);
  });
}

export function createRequestLogger(log: (message: string) => void): RequestHandler {
  return (req, res, next) => {
    const start = Date.now();
    const path = req.path;

    res.on("finish", () => {
      if (path.startsWith("/api")) {
        log(`${req.method} ${path} ${res.statusCode} in ${Date.now() - start}ms`);
      }
    });

    next();
  };
}

export const safeErrorHandler: ErrorRequestHandler = (_err, _req, res, next) => {
  const candidate = _err?.status ?? _err?.statusCode;
  const status = Number.isInteger(candidate) && candidate >= 400 && candidate <= 599
    ? candidate : 500;
  // Log no error objects, request bodies, query strings, or SQL parameters.
  console.error(`[http] ${_req.method} ${_req.path} failed (${status})`);
  if (res.headersSent) {
    next(_err);
    return;
  }

  res.status(status).json({ message: status >= 500 ? "Internal Server Error" : "Solicitud inválida" });
};