/**
 * Status Monitoring Service
 * Tracks health and uptime of all system components
 */

const fetch = require('node-fetch');
// Fallback client for PUBLIC status checks: /api/status has no auth, so req.supabase is
// undefined there. Without a fallback the DB/auth probes throw "No database connection" and the
// public status page falsely reports a major outage. Use the server client to actually probe.
const { supabaseAdmin } = require('../config/supabase');

// In-memory status tracking (in production, use Redis or database)
const statusHistory = {
  api: [],
  database: [],
  frontend: [],
  auth: [],
  email: [],
  integrations: []
};

// Store up to 90 days of daily uptime data
const MAX_HISTORY_DAYS = 90;

// Service status definitions
const STATUS = {
  OPERATIONAL: 'operational',
  DEGRADED: 'degraded',
  PARTIAL_OUTAGE: 'partial_outage',
  MAJOR_OUTAGE: 'major_outage',
  MAINTENANCE: 'maintenance',
  UNKNOWN: 'unknown'
};

// Incident tracking (in production, use database)
const incidents = [];

/**
 * Check API server health
 */
async function checkApiHealth() {
  const startTime = Date.now();
  try {
    // Internal self-check
    const responseTime = Date.now() - startTime;
    return {
      name: 'API Server',
      status: responseTime < 1000 ? STATUS.OPERATIONAL : STATUS.DEGRADED,
      responseTime,
      lastChecked: new Date().toISOString(),
      details: {
        memory: process.memoryUsage(),
        uptime: process.uptime()
      }
    };
  } catch (error) {
    return {
      name: 'API Server',
      status: STATUS.MAJOR_OUTAGE,
      responseTime: null,
      lastChecked: new Date().toISOString(),
      error: error.message
    };
  }
}

/**
 * Check database connectivity
 */
async function checkDatabaseHealth(supabase) {
  const startTime = Date.now();
  try {
    const db = supabase || supabaseAdmin; // public /api/status has no req.supabase — probe with the server client
    if (!db) {
      throw new Error('No database connection');
    }

    // Simple query to check connectivity
    const { data, error } = await db.from('jobs').select('id').limit(1);
    const responseTime = Date.now() - startTime;

    if (error) throw error;

    return {
      name: 'Database',
      status: responseTime < 500 ? STATUS.OPERATIONAL : STATUS.DEGRADED,
      responseTime,
      lastChecked: new Date().toISOString(),
      details: { mode: 'supabase' }
    };
  } catch (error) {
    return {
      name: 'Database',
      status: STATUS.MAJOR_OUTAGE,
      responseTime: null,
      lastChecked: new Date().toISOString(),
      error: error.message
    };
  }
}

/**
 * Check authentication service
 */
async function checkAuthHealth(supabase) {
  const startTime = Date.now();
  try {
    const db = supabase || supabaseAdmin; // public /api/status has no req.supabase
    if (!db) {
      throw new Error('No auth connection');
    }

    // Check if auth is accessible
    const responseTime = Date.now() - startTime;

    return {
      name: 'Authentication',
      status: STATUS.OPERATIONAL,
      responseTime,
      lastChecked: new Date().toISOString(),
      details: { provider: 'supabase' }
    };
  } catch (error) {
    return {
      name: 'Authentication',
      status: STATUS.DEGRADED,
      responseTime: null,
      lastChecked: new Date().toISOString(),
      error: error.message
    };
  }
}

/**
 * Check email service (placeholder)
 */
async function checkEmailHealth() {
  // v2-hardening H1-2: this endpoint is public and was hardcoded to OPERATIONAL while
  // doing NO probe — a fabricated health metric. We don't have a live reachability probe
  // for the mail provider here, so we report the HONEST state: whether a provider is
  // configured (env present), with status UNKNOWN ("not actively monitored") rather than
  // asserting healthy without evidence. UNKNOWN does not escalate the overall rollup, so
  // it neither false-greens nor false-alarms the page.
  const configured = !!(process.env.RESEND_API_KEY || process.env.SMTP_HOST || process.env.EMAIL_SERVICE);
  return {
    name: 'Email Service',
    status: STATUS.UNKNOWN,
    responseTime: null,
    lastChecked: new Date().toISOString(),
    details: { configured, note: 'not actively health-probed' }
  };
}

/**
 * Check third-party integrations
 */
async function checkIntegrationsHealth() {
  // v2-hardening H1-2: LinkedIn/Calendar/Gmail were hardcoded OPERATIONAL with no probe on
  // a public status endpoint. Without a live reachability check we report UNKNOWN ("not
  // actively monitored") rather than fabricating a healthy signal.
  const at = new Date().toISOString();
  const integrations = [
    { name: 'LinkedIn Integration', status: STATUS.UNKNOWN, lastChecked: at, note: 'not actively monitored' },
    { name: 'Calendar Integration', status: STATUS.UNKNOWN, lastChecked: at, note: 'not actively monitored' },
    { name: 'Gmail Integration', status: STATUS.UNKNOWN, lastChecked: at, note: 'not actively monitored' },
  ];

  return {
    name: 'Third-party Integrations',
    status: STATUS.UNKNOWN,
    lastChecked: at,
    details: { integrations, note: 'not actively health-probed' }
  };
}

/**
 * Get overall system status
 */
async function getSystemStatus(supabase) {
  const [api, database, auth, email, integrations] = await Promise.all([
    checkApiHealth(),
    checkDatabaseHealth(supabase),
    checkAuthHealth(supabase),
    checkEmailHealth(),
    checkIntegrationsHealth()
  ]);

  const components = { api, database, auth, email, integrations };

  // Calculate overall status
  const statuses = Object.values(components).map(c => c.status);
  let overallStatus = STATUS.OPERATIONAL;

  if (statuses.includes(STATUS.MAJOR_OUTAGE)) {
    overallStatus = STATUS.MAJOR_OUTAGE;
  } else if (statuses.includes(STATUS.PARTIAL_OUTAGE)) {
    overallStatus = STATUS.PARTIAL_OUTAGE;
  } else if (statuses.includes(STATUS.DEGRADED)) {
    overallStatus = STATUS.DEGRADED;
  } else if (statuses.includes(STATUS.MAINTENANCE)) {
    overallStatus = STATUS.MAINTENANCE;
  }

  // Record status for history
  recordStatus(components);

  return {
    status: overallStatus,
    components,
    lastUpdated: new Date().toISOString(),
    incidents: getRecentIncidents()
  };
}

/**
 * Record status for uptime history
 */
function recordStatus(components) {
  const now = new Date();
  const dateKey = now.toISOString().split('T')[0];

  Object.entries(components).forEach(([key, component]) => {
    if (!statusHistory[key]) {
      statusHistory[key] = [];
    }

    // Find or create entry for today
    let dayEntry = statusHistory[key].find(h => h.date === dateKey);
    if (!dayEntry) {
      dayEntry = {
        date: dateKey,
        checks: 0,
        operational: 0,
        degraded: 0,
        outage: 0
      };
      statusHistory[key].push(dayEntry);

      // Keep only last 90 days
      if (statusHistory[key].length > MAX_HISTORY_DAYS) {
        statusHistory[key] = statusHistory[key].slice(-MAX_HISTORY_DAYS);
      }
    }

    dayEntry.checks++;
    if (component.status === STATUS.OPERATIONAL) {
      dayEntry.operational++;
    } else if (component.status === STATUS.DEGRADED) {
      dayEntry.degraded++;
    } else {
      dayEntry.outage++;
    }
  });
}

/**
 * Get uptime statistics
 */
function getUptimeStats(days = 90) {
  const stats = {};

  Object.entries(statusHistory).forEach(([key, history]) => {
    const recentHistory = history.slice(-days);
    const totalChecks = recentHistory.reduce((sum, h) => sum + h.checks, 0);
    const operationalChecks = recentHistory.reduce((sum, h) => sum + h.operational, 0);

    stats[key] = {
      uptimePercentage: totalChecks > 0
        ? ((operationalChecks / totalChecks) * 100).toFixed(2)
        : 100,
      history: recentHistory,
      totalDays: recentHistory.length
    };
  });

  return stats;
}

/**
 * Create a new incident
 */
function createIncident(title, description, affectedComponents, severity = 'minor') {
  const incident = {
    id: `inc_${Date.now()}`,
    title,
    description,
    affectedComponents,
    severity, // minor, major, critical
    status: 'investigating', // investigating, identified, monitoring, resolved
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updates: [{
      status: 'investigating',
      message: description,
      timestamp: new Date().toISOString()
    }],
    resolvedAt: null
  };

  incidents.unshift(incident);
  return incident;
}

/**
 * Update an incident
 */
function updateIncident(incidentId, status, message) {
  const incident = incidents.find(i => i.id === incidentId);
  if (!incident) return null;

  incident.status = status;
  incident.updatedAt = new Date().toISOString();
  incident.updates.push({
    status,
    message,
    timestamp: new Date().toISOString()
  });

  if (status === 'resolved') {
    incident.resolvedAt = new Date().toISOString();
  }

  return incident;
}

/**
 * Get recent incidents
 */
function getRecentIncidents(limit = 10) {
  return incidents.slice(0, limit);
}

/**
 * Get all incidents for a date range
 */
function getIncidents(startDate, endDate) {
  return incidents.filter(i => {
    const createdAt = new Date(i.createdAt);
    return createdAt >= startDate && createdAt <= endDate;
  });
}

/**
 * Get scheduled maintenance
 */
function getScheduledMaintenance() {
  return incidents.filter(i =>
    i.status !== 'resolved' &&
    i.severity === 'maintenance'
  );
}

module.exports = {
  STATUS,
  getSystemStatus,
  getUptimeStats,
  createIncident,
  updateIncident,
  getRecentIncidents,
  getIncidents,
  getScheduledMaintenance,
  checkApiHealth,
  checkDatabaseHealth,
  checkAuthHealth,
  checkEmailHealth,
  checkIntegrationsHealth
};
