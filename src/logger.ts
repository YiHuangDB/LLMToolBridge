import fs from 'fs';
import path from 'path';

export class RequestLogger {
  private logDir: string;
  private currentLogFile: string;
  private logStream: fs.WriteStream | null = null;

  constructor(logDir: string = 'logs') {
    this.logDir = path.resolve(logDir);
    this.ensureLogDirectory();
    
    // Create a new log file with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    this.currentLogFile = path.join(this.logDir, `llm-proxy-${timestamp}.log`);
    
    // Open write stream
    this.logStream = fs.createWriteStream(this.currentLogFile, { flags: 'a' });
    
    this.writeLog('='.repeat(80));
    this.writeLog(`LLM Tool Bridge Proxy - Session Started: ${new Date().toISOString()}`);
    this.writeLog('='.repeat(80));
  }

  private ensureLogDirectory(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private writeLog(message: string): void {
    if (this.logStream) {
      this.logStream.write(message + '\n');
    }
    // Also log to console for debugging
    console.log(message);
  }

  private formatJSON(data: any): string {
    try {
      return JSON.stringify(data, null, 2);
    } catch (error) {
      return String(data);
    }
  }

  logClientRequest(requestId: string, method: string, url: string, headers: any, body: any): void {
    this.writeLog('\n' + '-'.repeat(80));
    this.writeLog(`[${new Date().toISOString()}] CLIENT -> PROXY`);
    this.writeLog(`Request ID: ${requestId}`);
    this.writeLog(`Method: ${method} ${url}`);
    this.writeLog(`Headers: ${this.formatJSON(this.sanitizeHeaders(headers))}`);
    this.writeLog(`Body:`);
    this.writeLog(this.formatJSON(body));
    this.writeLog('-'.repeat(80));
  }

  logProxyToLLM(requestId: string, url: string, headers: any, body: any): void {
    this.writeLog('\n' + '-'.repeat(80));
    this.writeLog(`[${new Date().toISOString()}] PROXY -> LLM BACKEND`);
    this.writeLog(`Request ID: ${requestId}`);
    this.writeLog(`Target URL: ${url}`);
    this.writeLog(`Headers: ${this.formatJSON(this.sanitizeHeaders(headers))}`);
    this.writeLog(`Body:`);
    this.writeLog(this.formatJSON(body));
    this.writeLog('-'.repeat(80));
  }

  logLLMResponse(requestId: string, statusCode: number | string, headers: any, body: any): void {
    this.writeLog('\n' + '-'.repeat(80));
    this.writeLog(`[${new Date().toISOString()}] LLM BACKEND -> PROXY`);
    this.writeLog(`Request ID: ${requestId}`);
    this.writeLog(`Status: ${statusCode}`);
    if (headers) {
      this.writeLog(`Headers: ${this.formatJSON(this.sanitizeHeaders(headers))}`);
    }
    this.writeLog(`Response:`);
    this.writeLog(this.formatJSON(body));
    this.writeLog('-'.repeat(80));
  }

  logProxyToClient(requestId: string, statusCode: number, body: any): void {
    this.writeLog('\n' + '-'.repeat(80));
    this.writeLog(`[${new Date().toISOString()}] PROXY -> CLIENT`);
    this.writeLog(`Request ID: ${requestId}`);
    this.writeLog(`Status: ${statusCode}`);
    this.writeLog(`Response:`);
    this.writeLog(this.formatJSON(body));
    this.writeLog('-'.repeat(80));
  }

  logToolExecution(requestId: string, toolName: string, toolArgs: any, toolResult: any): void {
    this.writeLog('\n' + '='.repeat(40));
    this.writeLog(`[${new Date().toISOString()}] TOOL EXECUTION`);
    this.writeLog(`Request ID: ${requestId}`);
    this.writeLog(`Tool: ${toolName}`);
    this.writeLog(`Arguments: ${this.formatJSON(toolArgs)}`);
    this.writeLog(`Result: ${this.formatJSON(toolResult)}`);
    this.writeLog('='.repeat(40));
  }

  logStreamChunk(requestId: string, chunk: string): void {
    // For streaming, we'll log in a more compact format
    if (!chunk.trim()) return;
    this.writeLog(`[STREAM ${requestId}] ${chunk}`);
  }

  logError(requestId: string, error: any, context: string): void {
    this.writeLog('\n' + '!'.repeat(80));
    this.writeLog(`[${new Date().toISOString()}] ERROR in ${context}`);
    this.writeLog(`Request ID: ${requestId}`);
    this.writeLog(`Error: ${error.message || error}`);
    if (error.stack) {
      this.writeLog(`Stack: ${error.stack}`);
    }
    this.writeLog('!'.repeat(80));
  }

  private sanitizeHeaders(headers: any): any {
    const sanitized = { ...headers };
    // Hide sensitive information in headers
    if (sanitized.authorization) {
      sanitized.authorization = sanitized.authorization.substring(0, 20) + '...';
    }
    if (sanitized.Authorization) {
      sanitized.Authorization = sanitized.Authorization.substring(0, 20) + '...';
    }
    if (sanitized['api-key']) {
      sanitized['api-key'] = '***';
    }
    return sanitized;
  }

  close(): void {
    if (this.logStream) {
      this.writeLog('\n' + '='.repeat(80));
      this.writeLog(`Session Ended: ${new Date().toISOString()}`);
      this.writeLog('='.repeat(80));
      this.logStream.end();
      this.logStream = null;
    }
  }
}