import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { config } from "./config/index.js";
import { errorHandler } from "./middleware/error-handler.js";
import { correlationId } from "./middleware/correlation-id.js";
import { metricsMiddleware } from "./config/metrics.js";
import { securityHeaders } from "./middleware/security-headers.js";
import routes from "./routes/index.js";
import webhookRoutes from "./routes/webhooks.routes.js";
import { ApiError } from "./utils/api-error.js";

const app = express();

// req.ip = real client IP behind N trusted proxies (not a spoofable
// left-most X-Forwarded-For value).
app.set("trust proxy", config.trustProxyHops);
app.disable("x-powered-by");

app.use(helmet());
app.use(securityHeaders);
app.use(correlationId);
app.use(metricsMiddleware);
app.use(cors({ origin: config.corsOrigins, credentials: true }));
if (config.nodeEnv !== "test") {
  app.use(morgan(config.isProduction ? "combined" : "dev"));
}
app.use(cookieParser());

// Webhooks need the RAW body for signature verification, so they are mounted
// before the JSON parser (each route applies express.raw itself).
app.use("/api/v1/webhooks", webhookRoutes);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

app.use("/api/v1", routes);

app.use((_req, _res, next) => next(ApiError.notFound("Route")));
app.use(errorHandler);

export default app;
