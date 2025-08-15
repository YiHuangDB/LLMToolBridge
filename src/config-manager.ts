import { LLMTarget, ProxyConfiguration, Model, ConfigurationStore } from './config-types';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

export class ConfigurationManager {
  private configPath: string;
  private config: ConfigurationStore = {
    proxy: {
      port: 3500,
      adminPort: 3501,
      chatApiKey: '',
      enableLogging: true,
      logLevel: 'info',
      corsOrigins: ['*'],
      maxRequestSize: '50mb',
      defaultTarget: undefined
    },
    targets: [],
    models: []
  };
  private defaultConfig: ConfigurationStore = {
    proxy: {
      port: 3500,
      adminPort: 3501,
      chatApiKey: process.env.CHAT_API_KEY || '', // Optional chat API key
      enableLogging: true,
      logLevel: 'info',
      corsOrigins: ['*'],
      maxRequestSize: '50mb',
      defaultTarget: undefined
    },
    targets: [],
    models: []
  };

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(process.cwd(), 'config.json');
    this.loadConfiguration();
    
    // If no targets configured and env variables exist, create default target
    if (this.config.targets.length === 0 && process.env.TARGET_LLM_API) {
      const defaultTarget: LLMTarget = {
        id: 'env-default',
        name: 'Environment Default',
        url: process.env.TARGET_LLM_API,
        apiKey: process.env.TARGET_LLM_API_KEY,
        model: process.env.TARGET_LLM_MODEL || 'default',
        enabled: true,
        priority: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      this.config.targets.push(defaultTarget);
      this.config.proxy.defaultTarget = 'env-default';
      this.saveConfiguration();
      console.log('Created default target from environment variables');
    }
  }

  private loadConfiguration(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        this.config = JSON.parse(data);
        console.log('Configuration loaded from', this.configPath);
      } else {
        this.config = this.defaultConfig;
        this.saveConfiguration();
        console.log('Created default configuration at', this.configPath);
        console.log('Admin interface: Open access (no authentication)');
        if (this.config.proxy.chatApiKey) {
          console.log('Chat API Key:', this.config.proxy.chatApiKey);
        } else {
          console.log('Chat API: No authentication required');
        }
      }
    } catch (error) {
      console.error('Error loading configuration:', error);
      this.config = this.defaultConfig;
    }
  }

  private saveConfiguration(): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('Error saving configuration:', error);
    }
  }

  // Proxy Configuration CRUD
  getProxyConfig(): ProxyConfiguration {
    return this.config.proxy;
  }

  updateProxyConfig(updates: Partial<ProxyConfiguration>): ProxyConfiguration {
    this.config.proxy = { ...this.config.proxy, ...updates };
    this.saveConfiguration();
    return this.config.proxy;
  }

  // LLM Target CRUD
  getAllTargets(): LLMTarget[] {
    return this.config.targets;
  }

  getTarget(id: string): LLMTarget | undefined {
    return this.config.targets.find(t => t.id === id);
  }

  getActiveTarget(): LLMTarget | undefined {
    // Get default target or first enabled target
    if (this.config.proxy.defaultTarget) {
      const defaultTarget = this.getTarget(this.config.proxy.defaultTarget);
      if (defaultTarget && defaultTarget.enabled) {
        return defaultTarget;
      }
    }
    
    // Return first enabled target sorted by priority
    return this.config.targets
      .filter(t => t.enabled)
      .sort((a, b) => a.priority - b.priority)[0];
  }

  createTarget(target: Omit<LLMTarget, 'id' | 'createdAt' | 'updatedAt'>): LLMTarget {
    const newTarget: LLMTarget = {
      ...target,
      id: uuidv4(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    this.config.targets.push(newTarget);
    this.saveConfiguration();
    return newTarget;
  }

  updateTarget(id: string, updates: Partial<LLMTarget>): LLMTarget | undefined {
    const index = this.config.targets.findIndex(t => t.id === id);
    if (index === -1) {
      return undefined;
    }
    
    this.config.targets[index] = {
      ...this.config.targets[index],
      ...updates,
      id, // Ensure ID cannot be changed
      updatedAt: new Date()
    };
    
    this.saveConfiguration();
    return this.config.targets[index];
  }

  deleteTarget(id: string): boolean {
    const index = this.config.targets.findIndex(t => t.id === id);
    if (index === -1) {
      return false;
    }
    
    this.config.targets.splice(index, 1);
    
    // Clear default target if it was deleted
    if (this.config.proxy.defaultTarget === id) {
      this.config.proxy.defaultTarget = undefined;
    }
    
    this.saveConfiguration();
    return true;
  }

  // Model Management
  getAllModels(): Model[] {
    return this.config.models;
  }
  
  // Get all enabled targets
  getEnabledTargets(): LLMTarget[] {
    return this.config.targets.filter(t => t.enabled);
  }
  
  // Get target by model name
  getTargetForModel(modelName: string): LLMTarget | undefined {
    // First check if we have a cached model with provider info
    const model = this.config.models.find(m => m.id === modelName);
    if (model) {
      // Find the target that matches this model's provider
      return this.config.targets.find(t => t.name === model.provider && t.enabled);
    }
    
    // Fallback: check each target's default model
    return this.config.targets.find(t => t.model === modelName && t.enabled);
  }
  
  // Fetch models from all enabled targets
  async fetchModelsFromAllTargets(): Promise<Model[]> {
    const enabledTargets = this.getEnabledTargets();
    const allModels: Model[] = [];
    
    for (const target of enabledTargets) {
      try {
        const models = await this.fetchModelsFromTarget(target.id);
        allModels.push(...models);
      } catch (error) {
        console.error(`Failed to fetch models from ${target.name}:`, error);
        // Continue with other targets even if one fails
      }
    }
    
    return allModels;
  }

  async fetchModelsFromTarget(targetId: string): Promise<Model[]> {
    const target = this.getTarget(targetId);
    if (!target) {
      throw new Error('Target not found');
    }

    try {
      // Try OpenAI-compatible models endpoint
      const headers: any = {
        'Content-Type': 'application/json',
      };
      
      if (target.apiKey) {
        headers['Authorization'] = `Bearer ${target.apiKey}`;
      }

      // Extract base URL from chat completions URL
      const baseUrl = target.url.replace('/chat/completions', '');
      const modelsUrl = `${baseUrl}/models`;

      const response = await axios.get(modelsUrl, {
        headers,
        timeout: target.timeout || 5000
      });

      if (response.data && response.data.data) {
        // OpenAI format
        return response.data.data.map((model: any) => ({
          id: model.id,
          name: model.id,
          provider: target.name,
          capabilities: {
            streaming: true,
            functionCalling: model.id.includes('gpt') || model.id.includes('claude'),
            vision: model.id.includes('vision') || model.id.includes('gpt-4'),
            maxTokens: model.max_tokens || 4096
          }
        }));
      } else if (response.data && response.data.models) {
        // Ollama format
        return response.data.models.map((model: any) => ({
          id: model.name || model.model,
          name: model.name || model.model,
          provider: target.name,
          capabilities: {
            streaming: true,
            functionCalling: false,
            vision: model.name?.includes('vision') || false,
            maxTokens: 4096
          }
        }));
      }
      
      return [];
    } catch (error) {
      console.error(`Failed to fetch models from ${target.name}:`, error);
      // Return a default model based on the target configuration
      return [{
        id: target.model,
        name: target.model,
        provider: target.name,
        capabilities: {
          streaming: true,
          functionCalling: false,
          vision: false,
          maxTokens: 4096
        }
      }];
    }
  }

  addModel(model: Model): Model {
    const existingIndex = this.config.models.findIndex(m => 
      m.id === model.id && m.provider === model.provider
    );
    
    if (existingIndex !== -1) {
      this.config.models[existingIndex] = model;
    } else {
      this.config.models.push(model);
    }
    
    this.saveConfiguration();
    return model;
  }

  removeModel(id: string, provider: string): boolean {
    const index = this.config.models.findIndex(m => 
      m.id === id && m.provider === provider
    );
    
    if (index === -1) {
      return false;
    }
    
    this.config.models.splice(index, 1);
    this.saveConfiguration();
    return true;
  }

  // Validation
  validateChatApiKey(apiKey: string): boolean {
    // If no chat API key is set, allow access
    if (!this.config.proxy.chatApiKey) {
      return true;
    }
    return apiKey === this.config.proxy.chatApiKey;
  }

  // Export/Import configuration
  exportConfiguration(): string {
    return JSON.stringify(this.config, null, 2);
  }

  importConfiguration(configJson: string): void {
    try {
      const newConfig = JSON.parse(configJson);
      // Validate structure
      if (!newConfig.proxy || !Array.isArray(newConfig.targets)) {
        throw new Error('Invalid configuration structure');
      }
      this.config = newConfig;
      this.saveConfiguration();
    } catch (error) {
      throw new Error(`Failed to import configuration: ${error}`);
    }
  }
}