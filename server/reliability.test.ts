import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";
import {
  createRequestLogger,
  installIdlePoolErrorHandler,
  safeErrorHandler,
} from "./reliability";

test("idle pool errors cannot crash the emitter or disclose error/client details", () => {
  const pool = new EventEmitter();
  const messages: string[] = [];
  const originalError = console.error;
  console.error = (message: string) => { messages.push(message); };
  try {
    installIdlePoolErrorHandler(pool as Pool);
    const error = Object.assign(new Error("password=private-value"), { code: "ECONNRESET" });
    pool.emit("error", error, { connectionString: "postgres://private-value" });
    pool.emit("error", Object.assign(new Error("secret"), { code: "secret\npassword" }));
  } finally {
    console.error = originalError;
  }
  assert.equal(messages.length, 2);
  assert.match(messages[0], /ECONNRESET/);
  assert.doesNotMatch(messages.join(" "), /private-value|password|secret|postgres:\/\//);
});

test("request logger records only method, path, status and duration", () => {
  const messages: string[] = [];
  const response = Object.assign(new EventEmitter(), { statusCode: 200, json: () => "sensitive body" });
  const originalJson = response.json;
  const request = { method: "GET", path: "/api/users" } as Request;
  let nextCalled = false;
  createRequestLogger((message) => messages.push(message))(
    request,
    response as unknown as Response,
    (() => { nextCalled = true; }) as NextFunction,
  );
  response.emit("finish");
  assert.equal(nextCalled, true);
  assert.equal(response.json, originalJson);
  assert.match(messages[0], /^GET \/api\/users 200 in \d+ms$/);
  assert.doesNotMatch(messages[0], /sensitive/);
});

test("error handler sends generic 500 without throwing or leaking details", () => {
  let status = 0;
  let body: unknown;
  const response = {
    headersSent: false,
    status(value: number) { status = value; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as Response;
  let forwarded = false;
  safeErrorHandler(new Error("private error"), {} as Request, response, (() => {
    forwarded = true;
  }) as NextFunction);
  assert.equal(status, 500);
  assert.deepEqual(body, { message: "Internal Server Error" });
  assert.equal(forwarded, false);
});

test("error handler delegates when headers are already sent", () => {
  const error = new Error("private error");
  let forwarded: unknown;
  const response = {
    headersSent: true,
    status() { throw new Error("must not write after headersSent"); },
  } as unknown as Response;
  safeErrorHandler(error, {} as Request, response, ((value: unknown) => {
    forwarded = value;
  }) as NextFunction);
  assert.equal(forwarded, error);
});