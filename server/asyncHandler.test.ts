import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { asyncHandler } from "./asyncHandler";

const req = {} as Request;
const res = {} as Response;

test("asyncHandler passes rejected route promises to next", async () => {
  const failure = new Error("route failed");
  const forwarded = new Promise<unknown>((resolve) => {
    asyncHandler(async () => {
      throw failure;
    })(req, res, resolve as NextFunction);
  });

  assert.equal(await forwarded, failure);
});

test("asyncHandler allows normal route returns without calling next", async () => {
  let calls = 0;
  let forwarded = false;
  const handler = asyncHandler(async () => {
    calls++;
    return res;
  });
  handler(req, res, (() => { forwarded = true; }) as NextFunction);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(calls, 1);
  assert.equal(forwarded, false);
});

test("asyncHandler passes synchronous throws to next", async () => {
  const failure = new Error("sync failure");
  const forwarded = new Promise<unknown>((resolve) => {
    asyncHandler(() => { throw failure; })(req, res, resolve as NextFunction);
  });
  assert.equal(await forwarded, failure);
});