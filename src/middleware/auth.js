import mongoose from "mongoose";
import { getAuth } from "@clerk/express";
import User from "../models/user.models.js";
import Project from "../models/project.models.js";
import { HttpError } from "../utils/httpError.js";

/** The Clerk user id of the request, or null when the request is signed out. */
export function authUserId(req) {
  try {
    return getAuth(req)?.userId || null;
  } catch {
    return null;
  }
}

/** Answers 401 as JSON for a signed-out request. Clerk's requireAuth() would redirect an API call instead. */
export function requireUser(req, res, next) {
  const userId = authUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized: sign in to continue." });
  req.userId = userId;
  next();
}

/** Finds the local user record of the signed-in user and creates it on first use, with the real email from Clerk. */
export async function ensureUser(userId, services) {
  let user = await User.findOne({ clerkId: userId });
  if (user) return user;
  let email;
  try {
    email = await services.identity.getEmail(userId);
  } catch {
    email = undefined;
  }
  user = await User.create({ clerkId: userId, email: email || `${userId}@users.invalid` });
  return user;
}

export async function loadUser(req, _res, next) {
  req.localUser = await ensureUser(req.userId, req.app.locals.services);
  next();
}

export const isObjectId = (value) => typeof value === "string" && mongoose.isValidObjectId(value) && /^[a-f\d]{24}$/i.test(value);

export function assertObjectId(value, label = "id") {
  if (!isObjectId(value)) throw new HttpError(400, `Invalid ${label}.`);
}

/** Returns the project when it belongs to the signed-in user, otherwise throws 400 or 404. */
export async function findOwnedProject(req, param = "projectId") {
  const id = req.params[param];
  assertObjectId(id, "project id");
  const project = await Project.findOne({ _id: id, user: req.localUser._id });
  if (!project) throw new HttpError(404, "Project not found.");
  return project;
}
