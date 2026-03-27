import { Router } from "express";
import { metrics } from "../metrics.js";

export const metricsRouter = Router();

metricsRouter.get("/metrics", (_req, res) => {
  res.json(metrics.toJSON());
});
