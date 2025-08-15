import { Router, Request, Response, NextFunction } from 'express';
import { ConfigurationManager } from './config-manager';
import { LLMTarget } from './config-types';
import * as fs from 'fs';
import * as path from 'path';

export class AdminAPI {
  private router: Router;
  private configManager: ConfigurationManager;

  constructor(configManager: ConfigurationManager) {
    this.router = Router();
    this.configManager = configManager;
    this.setupRoutes();
  }

  // No authentication required for admin API
  private authenticate = (req: Request, res: Response, next: NextFunction) => {
    // Admin API is always open - no authentication required
    next();
  };

  private setupRoutes(): void {
    // Health check (no auth required)
    this.router.get('/health', (req, res) => {
      const activeTarget = this.configManager.getActiveTarget();
      res.json({
        status: 'ok',
        activeTarget: activeTarget ? {
          id: activeTarget.id,
          name: activeTarget.name,
          url: activeTarget.url
        } : null,
        timestamp: new Date().toISOString()
      });
    });

    // Apply authentication to all admin routes
    this.router.use('/admin', this.authenticate);

    // Proxy Configuration
    this.router.get('/admin/config/proxy', (req, res) => {
      const config = this.configManager.getProxyConfig();
      // Don't send the chat API key in the response for security
      const { chatApiKey, ...safeConfig } = config;
      res.json(safeConfig);
    });

    this.router.put('/admin/config/proxy', (req, res) => {
      try {
        const updated = this.configManager.updateProxyConfig(req.body);
        res.json(updated);
      } catch (error) {
        res.status(400).json({ error: String(error) });
      }
    });

    // LLM Target CRUD
    this.router.get('/admin/targets', (req, res) => {
      const targets = this.configManager.getAllTargets();
      // Remove API keys from response for security
      const safeTargets = targets.map(({ apiKey, ...target }) => target);
      res.json(safeTargets);
    });

    this.router.get('/admin/targets/:id', (req, res) => {
      const target = this.configManager.getTarget(req.params.id);
      if (!target) {
        return res.status(404).json({ error: 'Target not found' });
      }
      const { apiKey, ...safeTarget } = target;
      res.json(safeTarget);
    });

    this.router.post('/admin/targets', (req, res) => {
      try {
        const newTarget = this.configManager.createTarget(req.body);
        const { apiKey, ...safeTarget } = newTarget;
        res.status(201).json(safeTarget);
      } catch (error) {
        res.status(400).json({ error: String(error) });
      }
    });

    this.router.put('/admin/targets/:id', (req, res) => {
      try {
        const updated = this.configManager.updateTarget(req.params.id, req.body);
        if (!updated) {
          return res.status(404).json({ error: 'Target not found' });
        }
        const { apiKey, ...safeTarget } = updated;
        res.json(safeTarget);
      } catch (error) {
        res.status(400).json({ error: String(error) });
      }
    });

    this.router.delete('/admin/targets/:id', (req, res) => {
      const deleted = this.configManager.deleteTarget(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Target not found' });
      }
      res.status(204).send();
    });

    // Set default target
    this.router.post('/admin/targets/:id/set-default', (req, res) => {
      const target = this.configManager.getTarget(req.params.id);
      if (!target) {
        return res.status(404).json({ error: 'Target not found' });
      }
      
      this.configManager.updateProxyConfig({ defaultTarget: req.params.id });
      res.json({ message: 'Default target updated' });
    });

    // Models
    this.router.get('/admin/models', (req, res) => {
      const models = this.configManager.getAllModels();
      res.json(models);
    });

    this.router.post('/admin/models/fetch/:targetId', async (req, res) => {
      try {
        const models = await this.configManager.fetchModelsFromTarget(req.params.targetId);
        models.forEach(model => this.configManager.addModel(model));
        res.json(models);
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    this.router.delete('/admin/models/:provider/:id', (req, res) => {
      const deleted = this.configManager.removeModel(req.params.id, req.params.provider);
      if (!deleted) {
        return res.status(404).json({ error: 'Model not found' });
      }
      res.status(204).send();
    });

    // Configuration export/import
    this.router.get('/admin/config/export', (req, res) => {
      const config = this.configManager.exportConfiguration();
      res.header('Content-Type', 'application/json');
      res.header('Content-Disposition', 'attachment; filename="llm-proxy-config.json"');
      res.send(config);
    });

    this.router.post('/admin/config/import', (req, res) => {
      try {
        const configJson = JSON.stringify(req.body);
        this.configManager.importConfiguration(configJson);
        res.json({ message: 'Configuration imported successfully' });
      } catch (error) {
        res.status(400).json({ error: String(error) });
      }
    });

    // Test target connection
    this.router.post('/admin/targets/:id/test', async (req, res) => {
      const target = this.configManager.getTarget(req.params.id);
      if (!target) {
        return res.status(404).json({ error: 'Target not found' });
      }

      try {
        const axios = require('axios');
        const headers: any = {
          'Content-Type': 'application/json',
        };
        
        if (target.apiKey) {
          headers['Authorization'] = `Bearer ${target.apiKey}`;
        }

        const testRequest = {
          model: target.model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 10,
          stream: false
        };

        const response = await axios.post(target.url, testRequest, {
          headers,
          timeout: 5000
        });

        res.json({
          success: true,
          message: 'Connection successful',
          response: {
            model: response.data.model,
            hasChoices: !!response.data.choices
          }
        });
      } catch (error: any) {
        res.json({
          success: false,
          message: 'Connection failed',
          error: error.message || String(error)
        });
      }
    });

    // Logs endpoints
    this.router.get('/admin/logs', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit as string) || 100;
        const offset = parseInt(req.query.offset as string) || 0;
        const search = req.query.search as string || '';
        const logsDir = path.join(process.cwd(), 'logs');
        
        if (!fs.existsSync(logsDir)) {
          return res.json({ logs: [], total: 0, hasMore: false });
        }

        // Get all log files sorted by modification time (most recent first)
        const logFiles = fs.readdirSync(logsDir)
          .filter(file => file.endsWith('.log'))
          .map(file => {
            try {
              const filePath = path.join(logsDir, file);
              const stats = fs.statSync(filePath);
              return {
                file,
                path: filePath,
                mtime: stats.mtime.getTime()
              };
            } catch (err) {
              // Skip files we can't access
              console.warn(`Cannot access log file ${file}:`, err);
              return null;
            }
          })
          .filter(file => file !== null)
          .sort((a, b) => b.mtime - a.mtime);

        if (logFiles.length === 0) {
          return res.json({ logs: [], total: 0, hasMore: false });
        }

        // Read and parse logs from the most recent file
        const allLogs: any[] = [];
        const currentLogFile = logFiles[0].path;
        
        try {
          const content = fs.readFileSync(currentLogFile, 'utf-8');
          const lines = content.split('\n');
          
          let currentEntry: any = null;
          const timestampRegex = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/;
          
          for (const line of lines) {
            const timestampMatch = line.match(timestampRegex);
            if (timestampMatch) {
              // Start of a new log entry
              if (currentEntry) {
                allLogs.push(currentEntry);
              }
              
              currentEntry = {
                timestamp: timestampMatch[1],
                type: 'info',
                message: line,
                details: []
              };
              
              // Determine log type
              if (line.includes('CLIENT -> PROXY')) currentEntry.type = 'request';
              else if (line.includes('PROXY -> LLM')) currentEntry.type = 'proxy';
              else if (line.includes('LLM BACKEND -> PROXY')) currentEntry.type = 'response';
              else if (line.includes('PROXY -> CLIENT')) currentEntry.type = 'client';
              else if (line.includes('ERROR')) currentEntry.type = 'error';
              else if (line.includes('TOOL EXECUTION')) currentEntry.type = 'tool';
            } else if (currentEntry && line.trim()) {
              // Add to current entry details
              currentEntry.details.push(line);
            }
          }
          
          // Add the last entry
          if (currentEntry) {
            allLogs.push(currentEntry);
          }
        } catch (error) {
          console.error('Error reading log file:', error);
        }

        // Filter by search term if provided
        let filteredLogs = allLogs;
        if (search) {
          const searchLower = search.toLowerCase();
          filteredLogs = allLogs.filter(log => 
            log.message.toLowerCase().includes(searchLower) ||
            log.details.some((d: string) => d.toLowerCase().includes(searchLower))
          );
        }

        // Sort by timestamp (most recent first)
        filteredLogs.sort((a, b) => 
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        // Apply pagination
        const total = filteredLogs.length;
        const paginatedLogs = filteredLogs.slice(offset, offset + limit);
        const hasMore = offset + limit < total;

        res.json({
          logs: paginatedLogs,
          total,
          hasMore,
          currentFile: logFiles[0].file,
          totalFiles: logFiles.length
        });
      } catch (error) {
        console.error('Error fetching logs:', error);
        res.status(500).json({ 
          error: 'Failed to fetch logs',
          logs: [],
          total: 0,
          hasMore: false
        });
      }
    });

    // Clear logs
    this.router.delete('/admin/logs', (req, res) => {
      try {
        const logsDir = path.join(process.cwd(), 'logs');
        
        if (fs.existsSync(logsDir)) {
          const files = fs.readdirSync(logsDir);
          files.forEach(file => {
            if (file.endsWith('.log')) {
              fs.unlinkSync(path.join(logsDir, file));
            }
          });
        }
        
        res.json({ message: 'Logs cleared successfully' });
      } catch (error) {
        res.status(500).json({ error: 'Failed to clear logs' });
      }
    });

    // Get log files list
    this.router.get('/admin/logs/files', (req, res) => {
      try {
        const logsDir = path.join(process.cwd(), 'logs');
        
        if (!fs.existsSync(logsDir)) {
          return res.json({ files: [] });
        }

        const files = fs.readdirSync(logsDir)
          .filter(file => file.endsWith('.log'))
          .map(file => {
            const stats = fs.statSync(path.join(logsDir, file));
            return {
              name: file,
              size: stats.size,
              modified: stats.mtime,
              created: stats.birthtime
            };
          })
          .sort((a, b) => b.modified.getTime() - a.modified.getTime());

        res.json({ files });
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch log files' });
      }
    });
  }

  getRouter(): Router {
    return this.router;
  }
}

// Models listing endpoint (separate from admin API)
export function createModelsEndpoint(configManager: ConfigurationManager): Router {
  const router = Router();

  // OpenAI-compatible models endpoint
  router.get('/v1/models', async (req, res) => {
    try {
      // Try to fetch fresh models from ALL enabled targets
      const freshModels = await configManager.fetchModelsFromAllTargets();
      
      if (freshModels.length > 0) {
        // Clear old models and add fresh ones
        const oldModels = configManager.getAllModels();
        oldModels.forEach(model => configManager.removeModel(model.id, model.provider));
        freshModels.forEach(model => configManager.addModel(model));
      }
      
      // Get all models (fresh or cached)
      const models = configManager.getAllModels();

      // Return models
      res.json({
        object: 'list',
        data: models.map(model => ({
          id: model.id,
          object: 'model',
          created: Date.now(),
          owned_by: model.provider,
          permission: [],
          root: model.id,
          parent: null
        }))
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}