import express from "express";
import { requireUser, loadUser } from "../middleware/auth.js";
import { getProjectDocuments, deleteDocument, retryDocument } from "../controllers/document.controllers.js";

// mergeParams makes :projectId of the parent router available here
const router = express.Router({ mergeParams: true });

router.use(requireUser, loadUser);

router.route("/").get(getProjectDocuments);
router.route("/:documentId").delete(deleteDocument);
router.route("/:documentId/retry").post(retryDocument);

export default router;
