#!/bin/bash

# Script to start both frontend and backend servers

# Function to handle cleanup when script is terminated
cleanup() {
  echo "Shutting down servers..."
  kill $FRONTEND_PID $BACKEND_PID 2>/dev/null
  exit 0
}

# Set cleanup function to run on SIGINT (Ctrl+C)
trap cleanup SIGINT

# Start Backend Server
echo "Starting backend server..."
cd backend
npm start &
BACKEND_PID=$!

# Wait for backend to start
sleep 2

# Start Frontend Server  
echo "Starting frontend server..."
cd ../frontend
npm start &
FRONTEND_PID=$!

echo "Both servers are running!"
echo "Frontend: http://localhost:3000"
echo "Backend: http://localhost:3001"
echo "Press Ctrl+C to stop both servers"

# Wait for both processes
wait $FRONTEND_PID $BACKEND_PID