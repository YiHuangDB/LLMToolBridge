import { Tool, ToolCall } from './types';

export class ToolExecutor {
  private toolImplementations: Map<string, Function>;

  constructor() {
    this.toolImplementations = new Map();
    this.registerBuiltInTools();
  }

  private registerBuiltInTools() {
    this.registerTool('get_current_weather', async (args: any) => {
      const { location, unit = 'celsius' } = args;
      const temp = Math.floor(Math.random() * 30) + 10;
      return {
        location,
        temperature: temp,
        unit,
        description: 'Partly cloudy',
      };
    });

    this.registerTool('calculate', async (args: any) => {
      const { expression } = args;
      try {
        const result = Function('"use strict"; return (' + expression + ')')();
        return { result };
      } catch (error) {
        return { error: 'Invalid expression' };
      }
    });

    this.registerTool('search_web', async (args: any) => {
      const { query } = args;
      return {
        results: [
          {
            title: `Search result for: ${query}`,
            snippet: 'This is a mock search result. In production, this would call a real search API.',
            url: 'https://example.com',
          },
        ],
      };
    });
  }

  registerTool(name: string, implementation: Function) {
    this.toolImplementations.set(name, implementation);
  }

  async executeToolCall(toolCall: ToolCall, availableTools: Tool[]): Promise<any> {
    const toolName = toolCall.function.name;
    const tool = availableTools.find(t => t.function.name === toolName);

    if (!tool) {
      // Tool not in the available tools list
      return {
        error: `Tool "${toolName}" not found in available tools`,
      };
    }

    // Check if this is a built-in tool we can execute
    const implementation = this.toolImplementations.get(toolName);
    
    if (!implementation) {
      // This is likely an external tool (like MCP tools)
      // The proxy should not execute these - they should be returned to the client
      return {
        error: `Tool "${toolName}" should be executed by the client, not the proxy`,
        isClientTool: true,
      };
    }

    try {
      const args = JSON.parse(toolCall.function.arguments);
      const result = await implementation(args);
      return result;
    } catch (error) {
      return {
        error: `Error executing tool "${toolName}": ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  async executeExternalTool(toolCall: ToolCall, endpoint: string, apiKey?: string): Promise<any> {
    try {
      const args = JSON.parse(toolCall.function.arguments);
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          tool: toolCall.function.name,
          arguments: args,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      return {
        error: `Error calling external tool: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}