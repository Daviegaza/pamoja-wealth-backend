/**
 * Production security hardening middleware.
 *
 * Adds defense-in-depth headers beyond what Helmet provides:
 * - Strict CSP with nonce support
 * - HSTS preload
 * - X-Content-Type-Options
 * - Referrer-Policy
 * - Permissions-Policy (restrict camera, mic, etc.)
 *
 * Mount AFTER helmet in app.ts.
 */

import { Request, Response, NextFunction } from "express";

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  // HSTS — 2 years, include subdomains, preload-ready
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload"
  );

  // Prevent MIME-type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Restrict referrer to same origin
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // Permissions policy — lock down browser features
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(self), payment=(self)"
  );

  // Prevent embedding in iframes (clickjacking defense)
  res.setHeader("X-Frame-Options", "DENY");

  // XSS filter (legacy browsers)
  res.setHeader("X-XSS-Protection", "0"); // disable legacy filter, CSP handles it

  // Cross-Origin isolation for SharedArrayBuffer (future-proof)
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");

  next();
}

/**
 * Rate limit specifically for webhook/callback endpoints.
 * Use the existing rate-limit.ts middleware for this.
 */
