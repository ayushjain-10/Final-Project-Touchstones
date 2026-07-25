/**
 * Status Page Routes
 * Public endpoints for system health and uptime monitoring
 */

const express = require('express');
const router = express.Router();
const statusService = require('../services/statusService');

/**
 * GET /api/status
 * Get overall system status
 */
router.get('/', async (req, res) => {
  try {
    const status = await statusService.getSystemStatus(req.supabase);
    res.json(status);
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({
      status: statusService.STATUS.UNKNOWN,
      error: 'Unable to determine system status'
    });
  }
});

/**
 * GET /api/status/components
 * Get detailed status for all components
 */
router.get('/components', async (req, res) => {
  try {
    const status = await statusService.getSystemStatus(req.supabase);
    res.json(status.components);
  } catch (error) {
    console.error('Components status error:', error);
    res.status(500).json({ error: 'Unable to get component status' });
  }
});

/**
 * GET /api/status/uptime
 * Get uptime statistics
 */
router.get('/uptime', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 90;
    const stats = statusService.getUptimeStats(Math.min(days, 90));
    res.json(stats);
  } catch (error) {
    console.error('Uptime stats error:', error);
    res.status(500).json({ error: 'Unable to get uptime statistics' });
  }
});

/**
 * GET /api/status/incidents
 * Get recent incidents
 */
router.get('/incidents', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const incidents = statusService.getRecentIncidents(limit);
    res.json(incidents);
  } catch (error) {
    console.error('Incidents fetch error:', error);
    res.status(500).json({ error: 'Unable to get incidents' });
  }
});

/**
 * GET /api/status/maintenance
 * Get scheduled maintenance
 */
router.get('/maintenance', async (req, res) => {
  try {
    const maintenance = statusService.getScheduledMaintenance();
    res.json(maintenance);
  } catch (error) {
    console.error('Maintenance fetch error:', error);
    res.status(500).json({ error: 'Unable to get maintenance schedule' });
  }
});

/**
 * GET /api/status/health
 * Simple health check endpoint (for uptime monitoring services)
 */
router.get('/health', async (req, res) => {
  try {
    const apiHealth = await statusService.checkApiHealth();
    const isHealthy = apiHealth.status === statusService.STATUS.OPERATIONAL;

    res.status(isHealthy ? 200 : 503).json({
      healthy: isHealthy,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      healthy: false,
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * GET /api/status/metrics
 * Get system metrics
 */
router.get('/metrics', async (req, res) => {
  try {
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();

    res.json({
      memory: {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        unit: 'MB'
      },
      uptime: {
        seconds: Math.round(uptime),
        formatted: formatUptime(uptime)
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Metrics error:', error);
    res.status(500).json({ error: 'Unable to get metrics' });
  }
});

/**
 * POST /api/status/incidents (Protected - Admin only)
 * Create a new incident
 */
router.post('/incidents', async (req, res) => {
  try {
    // In production, verify admin access here
    const { title, description, affectedComponents, severity } = req.body;

    if (!title || !description) {
      return res.status(400).json({ error: 'Title and description are required' });
    }

    const incident = statusService.createIncident(
      title,
      description,
      affectedComponents || [],
      severity || 'minor'
    );

    res.status(201).json(incident);
  } catch (error) {
    console.error('Create incident error:', error);
    res.status(500).json({ error: 'Unable to create incident' });
  }
});

/**
 * PUT /api/status/incidents/:id (Protected - Admin only)
 * Update an incident
 */
router.put('/incidents/:id', async (req, res) => {
  try {
    // In production, verify admin access here
    const { status, message } = req.body;

    if (!status || !message) {
      return res.status(400).json({ error: 'Status and message are required' });
    }

    const incident = statusService.updateIncident(req.params.id, status, message);

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    res.json(incident);
  } catch (error) {
    console.error('Update incident error:', error);
    res.status(500).json({ error: 'Unable to update incident' });
  }
});

/**
 * Format uptime seconds to human readable string
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);

  return parts.join(' ') || '< 1m';
}

module.exports = router;
