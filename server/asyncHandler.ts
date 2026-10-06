import type { RequestHandler } from "express";

// Express 4 does not forward rejected promises from route handlers to next.
export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    try {
      Promise.resolve(handler(req, res, next)).catch(next);
    } catch (error) {
      next(error);
    }
  };
}