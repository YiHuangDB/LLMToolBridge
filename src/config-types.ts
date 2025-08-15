export interface LLMTarget {
  id: string;
  name: string;
  url: string;
  apiKey?: string;
  model: string;
  enabled: boolean;
  priority: number;
  maxRetries?: number;
  timeout?: number;
  headers?: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProxyConfiguration {
  port: number;
  adminPort: number;
  chatApiKey?: string; // Optional API key for chat API endpoint only
  enableLogging: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  corsOrigins: string[];
  maxRequestSize: string;
  defaultTarget?: string;
}

export interface Model {
  id: string;
  name: string;
  provider: string;
  capabilities: {
    streaming: boolean;
    functionCalling: boolean;
    vision: boolean;
    maxTokens: number;
  };
  costPer1kTokens?: {
    input: number;
    output: number;
  };
}

export interface ConfigurationStore {
  proxy: ProxyConfiguration;
  targets: LLMTarget[];
  models: Model[];
}