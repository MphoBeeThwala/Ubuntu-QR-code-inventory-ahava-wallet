import { Router } from express
import { metricsEndpoint, healthCheckEndpoint } from ../middleware/metrics

const router = Router()

router.get("/health", healthCheckEndpoint("shared"))
router.get("/ready", (req, res) => res.json({ status: "ready" }))
router.get("/live", (req, res) => res.json({ status: "alive" }))
router.get("/metrics", metricsEndpoint)

export default router