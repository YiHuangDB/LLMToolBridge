import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ProxyHandler } from './proxy-handler';
import { RequestLogger } from './logger';
import { ChatCompletionRequest } from './types';
import { ConfigurationManager } from './config-manager';
import { AdminAPI, createModelsEndpoint } from './admin-api';

dotenv.config();

// Initialize configuration manager
const configManager = new ConfigurationManager();
const config = configManager.getProxyConfig();

// Initialize express apps
const app = express();
const adminApp = express();

// Use configured ports or fallback to env/defaults
const port = config.port || process.env.PORT || 3500;
const adminPort = config.adminPort || 3501;

// Initialize logger
const logger = new RequestLogger(process.env.LOG_DIR || 'logs');

// Increase JSON body size limit for large requests
app.use(express.json({ limit: config.maxRequestSize || '50mb' }));
adminApp.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Add CORS headers
const corsMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const origins = config.corsOrigins || ['*'];
  const origin = req.headers.origin;
  
  if (origins.includes('*') || (origin && origins.includes(origin))) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Api-Key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
};

app.use(corsMiddleware);
adminApp.use(corsMiddleware);

// Initialize admin API
const adminAPI = new AdminAPI(configManager);
adminApp.use('/api', adminAPI.getRouter());

// Add models endpoint to main app
app.use(createModelsEndpoint(configManager));

// Serve OpenAPI/Swagger specification
app.get('/swagger.json', (req, res) => {
  const fs = require('fs');
  const swaggerPath = path.join(__dirname, '..', 'public', 'swagger.json');
  
  try {
    const swaggerContent = fs.readFileSync(swaggerPath, 'utf-8');
    const swaggerDoc = JSON.parse(swaggerContent);
    
    // Update servers with actual port numbers
    swaggerDoc.servers = [
      {
        url: `http://localhost:${port}`,
        description: 'Main Proxy Server'
      },
      {
        url: `http://localhost:${adminPort}`,
        description: 'Admin API Server'
      }
    ];
    
    res.json(swaggerDoc);
  } catch (error) {
    console.error('Error serving swagger.json:', error);
    res.status(500).json({ error: 'Failed to load OpenAPI specification' });
  }
});

app.get('/openapi.json', (req, res) => {
  // Alias for swagger.json
  res.redirect('/swagger.json');
});

// Function to get or create proxy handler for specific model
const proxyHandlerCache = new Map<string, ProxyHandler>();

const getProxyHandlerForModel = (modelName: string): ProxyHandler => {
  // Find the target that provides this model
  const target = configManager.getTargetForModel(modelName);
  
  if (!target) {
    // Fallback to active target if model not found
    const activeTarget = configManager.getActiveTarget();
    if (!activeTarget) {
      throw new Error(`No target found for model '${modelName}' and no active target configured.`);
    }
    console.warn(`Model '${modelName}' not found in any target, using active target: ${activeTarget.name}`);
    
    // Use the active target but with the requested model
    const cacheKey = `${activeTarget.id}-${modelName}`;
    if (!proxyHandlerCache.has(cacheKey)) {
      proxyHandlerCache.set(cacheKey, new ProxyHandler({
        targetApiUrl: activeTarget.url,
        targetModel: modelName, // Use the requested model name
        apiKey: activeTarget.apiKey,
        maxRounds: 10,
      }, logger));
    }
    return proxyHandlerCache.get(cacheKey)!;
  }
  
  // Create or get cached handler for this target-model combination
  const cacheKey = `${target.id}-${modelName}`;
  if (!proxyHandlerCache.has(cacheKey)) {
    proxyHandlerCache.set(cacheKey, new ProxyHandler({
      targetApiUrl: target.url,
      targetModel: modelName, // Use the requested model name
      apiKey: target.apiKey,
      maxRounds: 10,
    }, logger));
  }
  
  return proxyHandlerCache.get(cacheKey)!;
};

app.post('/v1/chat/completions', async (req, res) => {
  const requestId = uuidv4();
  
  // Check chat API key if configured
  const config = configManager.getProxyConfig();
  if (config.chatApiKey) {
    const providedKey = req.headers['authorization']?.replace('Bearer ', '');
    if (!providedKey || !configManager.validateChatApiKey(providedKey)) {
      const errorResponse = {
        error: {
          message: 'Invalid or missing API key for chat endpoint',
          type: 'authentication_error',
        },
      };
      logger.logError(requestId, new Error('Authentication failed'), 'Chat API Auth');
      return res.status(401).json(errorResponse);
    }
  }
  
  try {
    const request: ChatCompletionRequest = req.body;
    
    // Log incoming client request
    logger.logClientRequest(
      requestId,
      req.method,
      req.url,
      req.headers,
      request
    );
    
    // Get the appropriate proxy handler based on the model
    let proxyHandler: ProxyHandler;
    try {
      const modelName = request.model || 'default';
      proxyHandler = getProxyHandlerForModel(modelName);
      console.log(`Routing model '${modelName}' to target`);
    } catch (error) {
      const errorResponse = {
        error: {
          message: error instanceof Error ? error.message : 'No LLM target configured for this model',
          type: 'configuration_error',
        },
      };
      logger.logError(requestId, error, 'Configuration');
      return res.status(503).json(errorResponse);
    }
    
    if (request.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      try {
        const stream = await proxyHandler.handleStreamingRequest(request);
        
        for await (const chunk of stream) {
          const chunkData = `data: ${JSON.stringify(chunk)}\n\n`;
          res.write(chunkData);
          logger.logStreamChunk(requestId, chunkData);
        }
        
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (streamError) {
        // If we haven't started writing yet, we can send an error
        if (!res.headersSent) {
          const errorResponse = {
            error: {
              message: streamError instanceof Error ? streamError.message : 'Stream error',
              type: 'stream_error',
            },
          };
          logger.logError(requestId, streamError, 'Stream Handler');
          logger.logProxyToClient(requestId, 500, errorResponse);
          res.status(500).json(errorResponse);
        } else {
          // Headers already sent, send error in SSE format
          const errorChunk = {
            error: {
              message: streamError instanceof Error ? streamError.message : 'Stream error',
              type: 'stream_error',
            },
          };
          res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          logger.logError(requestId, streamError, 'Stream Handler (headers sent)');
        }
      }
    } else {
      const response = await proxyHandler.handleRequest(request);
      res.json(response);
    }
  } catch (error) {
    const errorResponse = {
      error: {
        message: error instanceof Error ? error.message : 'Internal server error',
        type: 'internal_error',
      },
    };
    
    logger.logError(requestId, error, 'Request Handler');
    logger.logProxyToClient(requestId, 500, errorResponse);
    
    // Only send error response if headers haven't been sent
    if (!res.headersSent) {
      res.status(500).json(errorResponse);
    }
  }
});

app.get('/health', (req, res) => {
  const activeTarget = configManager.getActiveTarget();
  res.json({ 
    status: 'healthy',
    activeTarget: activeTarget ? activeTarget.name : 'none',
    adminPort: adminPort
  });
});

// Start main proxy server
app.listen(port, () => {
  console.log('================================================================================');
  console.log('LLM Tool Bridge Proxy - Session Started:', new Date().toISOString());
  console.log('================================================================================');
  console.log(`LLM Tool Bridge proxy listening at http://localhost:${port}`);
  
  const activeTarget = configManager.getActiveTarget();
  if (activeTarget) {
    console.log(`Target LLM API: ${activeTarget.url}`);
  } else {
    console.log('No LLM target configured. Use admin API to configure.');
  }
  
  console.log(`Logging to: ${path.resolve(process.env.LOG_DIR || 'logs')}`);
});

// Add swagger endpoint to admin API as well
adminApp.get('/swagger.json', (req, res) => {
  const fs = require('fs');
  const swaggerPath = path.join(__dirname, '..', 'public', 'swagger.json');
  
  try {
    const swaggerContent = fs.readFileSync(swaggerPath, 'utf-8');
    const swaggerDoc = JSON.parse(swaggerContent);
    
    // Update servers with actual port numbers
    swaggerDoc.servers = [
      {
        url: `http://localhost:${port}`,
        description: 'Main Proxy Server'
      },
      {
        url: `http://localhost:${adminPort}`,
        description: 'Admin API Server'
      }
    ];
    
    res.json(swaggerDoc);
  } catch (error) {
    console.error('Error serving swagger.json:', error);
    res.status(500).json({ error: 'Failed to load OpenAPI specification' });
  }
});

// Start admin server
adminApp.listen(adminPort, () => {
  console.log(`Admin API listening at http://localhost:${adminPort}`);
  console.log('Admin Interface: Open access (no authentication required)');
  
  if (config.chatApiKey) {
    console.log(`Chat API Key Required: ${config.chatApiKey}`);
  } else {
    console.log('Chat API: Open access (no authentication required)');
  }
  
  console.log('');
  console.log('Quick Start:');
  console.log(`  1. Open admin UI: http://localhost:${port}/`);
  console.log(`  2. Configure LLM target via UI`);
  console.log(`  3. Test your configuration in the Playground`);
  console.log(`  4. Optionally set Chat API key in Security section`);
  console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  logger.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down gracefully...');
  logger.close();
  process.exit(0);
});