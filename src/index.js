import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { clerkMiddleware, requireAuth } from '@clerk/express';
import connectDB from './config/db.js'; // Import the db connection function
import projectRoutes from './routes/project.routes.js';
import chatRoutes from './routes/chat.routes.js';

// Import UploadThing
import { createRouteHandler } from "uploadthing/express";
import { uploadRouter } from "./uploadthing.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 8000;

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
    app.use(express.json());
    app.use(clerkMiddleware());
    // Mount the UploadThing route handler
    app.use(
      "/api/uploadthing",
      createRouteHandler({ router: uploadRouter })
    );

    app.use('/api/projects/:projectId/chats', chatRoutes);
    app.use('/api/projects', projectRoutes);

    

    app.listen(port, () => {
      console.log(`[server]: Server is running at http://localhost:${port}`);
    });

  } catch (error) {
    console.error("Failed to start server:", error);
  }
};

startServer();