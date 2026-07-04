import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import swaggerUi from "swagger-ui-express";
import { config } from "./config/index.js";
import { errorHandler } from "./middleware/error-handler.js";
import { swaggerSpec } from "./config/swagger.js";
import { correlationId } from "./middleware/correlation-id.js";
import { metricsMiddleware } from "./config/metrics.js";
import { securityHeaders } from "./middleware/security-headers.js";
import routes from "./routes/index.js";

const app = express();

// Global middleware
app.use(helmet());
app.use(securityHeaders);
app.use(correlationId);
app.use(metricsMiddleware);
app.use(cors({
  origin: config.corsOrigins,
  credentials: true,
}));
app.use(morgan(config.nodeEnv === "production" ? "combined" : "dev"));
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Mount all API routes under /api/v1
app.use("/api/v1", routes);

// Swagger API documentation
app.use("/api/v1/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: ".swagger-ui .topbar { display: none }",
  customSiteTitle: "Pamoja Wealth API Docs",
}));

// Serve the raw OpenAPI spec as JSON
app.get("/api/v1/docs.json", (_req, res) => {
  res.json(swaggerSpec);
});

// Global error handler (must be last)
app.use(errorHandler);

export default app;
