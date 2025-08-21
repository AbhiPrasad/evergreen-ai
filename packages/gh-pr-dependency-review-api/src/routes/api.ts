import { Router } from 'express';
import { analyzePR } from '../controllers/analyze-pr.js';

const router = Router();

router.get('/analyze-pr', analyzePR);

export default router;