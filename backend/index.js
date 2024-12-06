const express = require("express");
const http = require("http");
const socketio = require("socket.io");
const cors = require("cors");

// Create Express app
const app = express();

// CORS configuration
const corsOptions = {
  origin: [
    "https://live-tracking-5iq4.vercel.app",
    "http://localhost:3000",
    "http://localhost:3001"
  ],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create HTTP server
const server = http.createServer(app);

// Socket.IO configuration
const io = socketio(server, {
  cors: corsOptions,
  pingTimeout: 60000, // Increase ping timeout
});

// Enhanced State Management
const state = {
  currentRoute: null,
  driverLocation: null,
  connectedUsers: new Map(),
  driverUpdateHistory: [],
  deviationHistory: [],
  activeRoutes: new Map()
};

/**
 * Calculate geodesic distance between two points using Haversine formula
 * @param {Object} point1 - First point with lat and lng
 * @param {Object} point2 - Second point with lat and lng
 * @returns {number} Distance in meters
 */
function calculateDistance(point1, point2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = point1.lat * Math.PI/180;
  const φ2 = point2.lat * Math.PI/180;
  const Δφ = (point2.lat - point1.lat) * Math.PI/180;
  const Δλ = (point2.lng - point1.lng) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

// Socket.IO Connection Handling
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // User Role and Connection Tracking
  const role = socket.handshake.query.role || 'unknown';
  const connectionTime = new Date();
  
  state.connectedUsers.set(socket.id, { 
    role, 
    connectionTime,
    lastUpdate: connectionTime 
  });

  // Handle user role assignment
  socket.on("user-role", ({ role }) => {
    const userInfo = state.connectedUsers.get(socket.id);
    if (userInfo) {
      userInfo.role = role;
      userInfo.lastUpdate = new Date();
      console.log(`User ${socket.id} registered as ${role}`);
    }
  });

  // Route Creation Handling
  socket.on("route-created", (routeData) => {
    console.log("New route created:", routeData);
    
    // Validate route data
    if (routeData && routeData.waypoints) {
      state.currentRoute = {
        ...routeData,
        createdAt: new Date().toISOString()
      };
      
      state.activeRoutes.set(socket.id, state.currentRoute);
      
      // Broadcast route to all connected clients
      io.emit("route-broadcast", state.currentRoute);
    }
  });

  // Enhanced Driver Location Handling
  socket.on("driver-location-update", (data) => {
    const userInfo = state.connectedUsers.get(socket.id);
    
    // Verify driver role and validate location data
    if (userInfo?.role === 'driver' && 
        data.latitude && 
        data.longitude) {
      
      const locationUpdate = {
        ...data,
        driverId: socket.id,
        timestamp: new Date().toISOString()
      };

      state.driverLocation = locationUpdate;

      // Route Deviation Detection
      if (state.currentRoute && state.currentRoute.waypoints) {
        const waypoints = state.currentRoute.waypoints;
        let minDistance = Infinity;
        
        // Find minimum distance to route waypoints
        for (let waypoint of waypoints) {
          const distance = calculateDistance(
            { lat: data.latitude, lng: data.longitude },
            { lat: waypoint.lat, lng: waypoint.lng }
          );
          minDistance = Math.min(minDistance, distance);
        }

        // Deviation Threshold (100 meters)
        if (minDistance > 100) {
          const deviationData = {
            timestamp: new Date().toISOString(),
            driverId: socket.id,
            location: { 
              lat: data.latitude, 
              lng: data.longitude 
            },
            distance: minDistance,
            message: `Driver deviated ${Math.round(minDistance)}m from planned route`
          };

          state.deviationHistory.push(deviationData);
          io.emit("route-deviation", deviationData);
        }
      }

      // Broadcast location update to other clients
      socket.broadcast.emit("driver-location-update", locationUpdate);
      
      // Store update history
      state.driverUpdateHistory.push(locationUpdate);
    }
  });

  // Route Saving
  socket.on("route-saved", (routeData) => {
    console.log("Route saved:", routeData);
    
    if (routeData) {
      state.activeRoutes.set(socket.id, {
        ...routeData,
        savedAt: new Date().toISOString()
      });
    }
  });

  // Initial State Request
  socket.on("request-initial-state", () => {
    socket.emit("initial-state", {
      driverLocation: state.driverLocation,
      currentRoute: state.currentRoute,
      deviationHistory: state.deviationHistory,
      connectedUsers: Array.from(state.connectedUsers.entries())
    });
    
    // Send active route if exists
    if (state.currentRoute) {
      socket.emit("route-broadcast", state.currentRoute);
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    const userInfo = state.connectedUsers.get(socket.id);
    if (userInfo?.role === 'driver') {
      // Clear driver location when driver disconnects
      state.driverLocation = null;
      socket.broadcast.emit("driver-disconnected");
    }
    state.connectedUsers.delete(socket.id);
    console.log("Client disconnected:", socket.id);
  });
});

// Diagnostic endpoint for system status
app.get("/api/status", (req, res) => {
  res.json({
    connectedUsers: Array.from(state.connectedUsers.entries()).map(([id, user]) => ({
      id,
      role: user.role,
      connectionTime: user.connectionTime
    })),
    activeRoutes: Array.from(state.activeRoutes.entries()),
    lastDriverUpdate: state.driverLocation,
    deviationHistory: state.deviationHistory,
    updateCount: state.driverUpdateHistory.length
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({ message: "Live Tracking Backend is running" });
});

// Export for Vercel serverless functions
module.exports = app;

// Only run the server if not in serverless environment
if (process.env.NODE_ENV !== 'vercel') {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}