// Import web-streams-polyfill to provide ReadableStream
const { ReadableStream, WritableStream, TransformStream } = require('web-streams-polyfill');

// Polyfill global objects if they don't exist
if (typeof global.ReadableStream === 'undefined') {
  global.ReadableStream = ReadableStream;
}

if (typeof global.WritableStream === 'undefined') {
  global.WritableStream = WritableStream;
}

if (typeof global.TransformStream === 'undefined') {
  global.TransformStream = TransformStream;
}

// Polyfill for SlowBuffer that was removed in Node.js v24+
// This helps compatibility with packages like buffer-equal-constant-time
if (typeof global.SlowBuffer === 'undefined') {
  const bufferModule = require('buffer');
  const { Buffer } = bufferModule;

  // Cannot extend Buffer with class syntax in Node 25+, use a factory approach
  function SlowBuffer(size) {
    return Buffer.alloc(size);
  }

  // Make SlowBuffer behave like a constructor for instanceof checks
  SlowBuffer.prototype = Object.create(Buffer.prototype);
  SlowBuffer.prototype.constructor = SlowBuffer;

  // Patch buffer-equal-constant-time compatibility
  // The package checks `Buffer.prototype` for SlowBuffer - ensure it exists
  if (!bufferModule.SlowBuffer) {
    bufferModule.SlowBuffer = SlowBuffer;
  }

  global.SlowBuffer = SlowBuffer;

  console.log('SlowBuffer polyfill loaded successfully');
}

// Polyfill global WebSocket for Node < 21 (Render runs Node 20). @supabase/realtime-js
// (>= 2.9x) throws "Node.js 20 detected without native WebSocket support" at client
// construction even though this backend only uses Supabase over REST. Providing the `ws`
// constructor satisfies the check with zero functional impact. polyfill.js is required first
// in app.js, so this runs before config/supabase.js creates the client.
if (typeof global.WebSocket === 'undefined') {
  try {
    global.WebSocket = require('ws');
    console.log('WebSocket polyfill (ws) loaded successfully');
  } catch (_) { /* ws optional; only needed on Node < 21 */ }
}

console.log('Web Streams API polyfill loaded successfully');