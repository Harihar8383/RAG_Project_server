import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { clerkMiddleware, requireAuth } from '@clerk/express';
import connectDB from './config/db.js'; // Import the db connection function
import projectRoutes from './routes/project.routes.js';
import chatRoutes from './routes/chat.routes.js';

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
    app.use('/api/projects/:projectId/chats', chatRoutes);
    app.use('/api/projects', projectRoutes);

    // Routes
    app.get('/api', (req, res) => {
      res.json({ message: 'Hello from the public server!' });
    });

    app.get('/api/protected', requireAuth(), (req, res) => {
      res.json({
        message: 'Hello from the protected server!',
        userId: req.auth.userId
      });
    });

    app.listen(port, () => {
      console.log(`[server]: Server is running at http://localhost:${port}`);
    });

  } catch (error) {
    console.error("Failed to start server:", error);
  }
};

startServer();