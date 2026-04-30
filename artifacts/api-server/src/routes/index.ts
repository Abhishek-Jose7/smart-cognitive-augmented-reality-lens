import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scarlRouter from "./scarl";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scarlRouter);

export default router;
