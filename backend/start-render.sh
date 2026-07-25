#!/bin/bash

# Start script for Render.com deployment
# This script handles Node.js compatibility issues

# Force Node.js to use old behavior for compatibility
export NODE_OPTIONS="--no-experimental-fetch"

# Create .env file from environment variables if it doesn't exist
if [ ! -f .env ]; then
  echo "Creating .env file from environment variables..."
  
  # Essential variables
  echo "NODE_ENV=${NODE_ENV:-production}" > .env
  echo "PORT=${PORT:-10000}" >> .env
  echo "MONGODB_URI=${MONGODB_URI}" >> .env
  echo "JWT_SECRET=${JWT_SECRET:-touchstone-default-jwt-secret}" >> .env
  echo "FRONTEND_URL=${FRONTEND_URL:-https://touchstones.ai}" >> .env
  
  # Enable development bypass for production testing
  echo "USE_MOCK_DB=${USE_MOCK_DB:-false}" >> .env
  echo "ALLOW_MOCK_AUTH=${ALLOW_MOCK_AUTH:-true}" >> .env
  
  # API keys for job searching
  if [ ! -z "$RAPIDAPI_KEY" ]; then
    echo "RAPIDAPI_KEY=${RAPIDAPI_KEY}" >> .env
  fi
  
  if [ ! -z "$JOB_SEARCH_API_KEY" ]; then
    echo "JOB_SEARCH_API_KEY=${JOB_SEARCH_API_KEY}" >> .env
  fi
  
  # Azure services
  if [ ! -z "$AZURE_LANGUAGE_ENDPOINT" ]; then
    echo "AZURE_LANGUAGE_ENDPOINT=${AZURE_LANGUAGE_ENDPOINT}" >> .env
    echo "AZURE_LANGUAGE_KEY=${AZURE_LANGUAGE_KEY}" >> .env
  fi
  
  if [ ! -z "$AZURE_OPENAI_ENDPOINT" ]; then
    echo "AZURE_OPENAI_ENDPOINT=${AZURE_OPENAI_ENDPOINT}" >> .env
    echo "AZURE_OPENAI_KEY=${AZURE_OPENAI_KEY}" >> .env
    echo "AZURE_OPENAI_DEPLOYMENT=${AZURE_OPENAI_DEPLOYMENT}" >> .env
  fi
  
  if [ ! -z "$AZURE_FORM_RECOGNIZER_ENDPOINT" ]; then
    echo "AZURE_FORM_RECOGNIZER_ENDPOINT=${AZURE_FORM_RECOGNIZER_ENDPOINT}" >> .env
    echo "AZURE_FORM_RECOGNIZER_KEY=${AZURE_FORM_RECOGNIZER_KEY}" >> .env
  fi
  
  # OpenAI fallback
  if [ ! -z "$OPENAI_API_KEY" ]; then
    echo "OPENAI_API_KEY=${OPENAI_API_KEY}" >> .env
  fi
  
  echo ".env file created successfully"
fi

# Ensure uploads directory exists
mkdir -p uploads

# Create override for SlowBuffer if needed
if [ "$(node -v | cut -d. -f1 | tr -d 'v')" -gt "23" ]; then
  echo "Detected Node.js v24 or higher, patching SlowBuffer..."
  cat > node-patch.js << EOF
// Monkey patch for SlowBuffer in Node.js v24+
if (typeof global.SlowBuffer === 'undefined') {
  const { Buffer } = require('buffer');
  class SlowBuffer extends Buffer {
    constructor(size) { super(size); }
  }
  SlowBuffer.prototype.equal = function(other) {
    return this.compare(other) === 0;
  };
  global.SlowBuffer = SlowBuffer;
  console.log('SlowBuffer polyfill activated for Node.js compatibility');
}
EOF
  # Use the patch
  export NODE_OPTIONS="$NODE_OPTIONS --require ./node-patch.js"
fi

# Start the application
echo "Starting application with Node.js $(node --version)"
echo "Environment: ${NODE_ENV}"
echo "Port: ${PORT}"
echo "Using NODE_OPTIONS: ${NODE_OPTIONS}"
node src/app.js