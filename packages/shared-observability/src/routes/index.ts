import { Router } from 'express'
import healthRouter from './health'

const router: Router = Router()
router.use('/health', healthRouter)

export default router