import { Router, Request, Response, NextFunction } from 'express';
import { ConfigurationManager } from './config-manager';
import { LLMTarget } from './config-types';

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