import express from "express";
import { requireUser, loadUser } from "../middleware/auth.js";
import { getExamMap, createExamMap, correctExamMapItem } from "../controllers/examMap.controllers.js";

// mergeParams makes :projectId of the parent router available here
const router = express.Router({ mergeParams: true });

router.use(requireUser, loadUser);

router.route("/").get(getExamMap).post(createExamMap);
router.route("/:mapId/items/:itemId").patch(correctExamMapItem);

export default router;
