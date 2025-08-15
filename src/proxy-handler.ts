import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { ToolConverter } from './tool-converter';
import { ToolExecutor } from './tool-executor';
import { StreamHandler } from './stream-handler';
import { RequestLogger } from './logger';
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  Message,
  Tool,
  ToolCall,
  StreamChunk
} from './types';

export interface ProxyConfig {
  targetApiUrl: string;
  targetModel: string;
  apiKey?: string;
  maxRounds?: number;
}

export class ProxyHandler {
  private toolConverter: ToolConverter;
  private toolExecutor: ToolExecutor;
  private streamHandler: StreamHandler;
  private config: ProxyConfig;
  private logger: RequestLogger;

  constructor(config: ProxyConfig, logger: RequestLogger) {
    this.config = {
      ...config,
      maxRounds: config.maxRounds || 10,
    };
    this.toolConverter = new ToolConverter();
    this.toolExecutor = new ToolExecutor();
    this.streamHandler = new StreamHandler();
    this.logger = logger;
  }

  async handleRequest(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const conversationId = uuidv4();
    let messages = [...request.messages];
    let tools = request.tools || [];
    let round = 0;

    // Check if the last message is a tool response - if so, we need to get final answer from LLM
    const hasToolResponse = messages.some(m => m.role === 'tool');
    const shouldInjectTools = tools.length > 0 && !hasToolResponse;

    if (shouldInjectTools) {
      const toolSystemPrompt = this.toolConverter.convertToolsToSystemPrompt(tools);
      messages = this.injectToolSystemPrompt(messages, toolSystemPrompt);
    }

    while (round < this.config.maxRounds!) {
      const targetMessages = this.prepareMessagesForTarget(messages);
      const response = await this.callTargetLLM(targetMessages, request, tools, conversationId);
      
      // Don't extract tool calls if we just processed a tool response
      if (!hasToolResponse) {
        const toolCall = this.toolConverter.extractToolCallFromResponse(response);
        
        if (toolCall) {
          // When a tool call is detected, return it to the client
          // The client will handle the tool execution
          const textBefore = this.toolConverter.extractTextBeforeToolCall(response);
          // Only include text if it's meaningful (not just whitespace)
          const meaningfulText = textBefore && textBefore.trim() ? textBefore : '';
          const toolCallResponse = this.createToolCallResponse(
            conversationId,
            toolCall,
            meaningfulText,
            request.model
          );
          this.logger.logProxyToClient(conversationId, 200, toolCallResponse);
          return toolCallResponse;
        }
      }

      const finalResponse = this.createCompletionResponse(conversationId, response, request.model);
      this.logger.logProxyToClient(conversationId, 200, finalResponse);
      return finalResponse;
    }

    const error = new Error(`Maximum conversation rounds (${this.config.maxRounds}) exceeded`);
    this.logger.logError(conversationId, error, 'handleRequest');
    throw error;
  }

  async *handleStreamingRequest(request: ChatCompletionRequest): AsyncGenerator<StreamChunk> {
    const conversationId = uuidv4();
    let messages = [...request.messages];
    let tools = request.tools || [];
    let round = 0;

    // Check if the last message is a tool response - if so, we need to get final answer from LLM
    const hasToolResponse = messages.some(m => m.role === 'tool');
    const shouldInjectTools = tools.length > 0 && !hasToolResponse;

    if (shouldInjectTools) {
      const toolSystemPrompt = this.toolConverter.convertToolsToSystemPrompt(tools);
      messages = this.injectToolSystemPrompt(messages, toolSystemPrompt);
    }

    while (round < this.config.maxRounds!) {
      const targetMessages = this.prepareMessagesForTarget(messages);
      let fullResponse = '';
      
      const stream = this.streamTargetLLM(targetMessages, request, conversationId);
      let toolCallDetected = false;
      let bufferedChunks: string[] = [];

      // Consume the stream once, buffering the response
      for await (const chunk of stream) {
        fullResponse += chunk;
        
        // Only look for tool calls if we haven't just processed a tool response
        if (!hasToolResponse) {
          // Early detection of potential tool call patterns
          const trimmed = fullResponse.trim();
          const looksLikeToolCall = trimmed.startsWith('{') || 
                                   trimmed.startsWith('\n{') ||
                                   trimmed.includes('"function_call"');
          
          if (looksLikeToolCall && !toolCallDetected) {
            toolCallDetected = true;
            // Buffer chunks instead of yielding when we detect a tool call pattern
            bufferedChunks.push(chunk);
          } else if (toolCallDetected) {
            // Continue buffering if tool call was detected
            bufferedChunks.push(chunk);
          } else {
            // Stream normally if no tool call pattern detected
            yield this.createStreamChunk(conversationId, chunk, request.model);
          }
        } else {
          // If we have a tool response, stream the final answer normally
          yield this.createStreamChunk(conversationId, chunk, request.model);
        }
      }

      // Don't extract tool calls if we just processed a tool response
      if (!hasToolResponse) {
        const toolCall = this.toolConverter.extractToolCallFromResponse(fullResponse);
        
        if (toolCall) {
          // Extract any text that comes before the tool call JSON
          const textBefore = this.toolConverter.extractTextBeforeToolCall(fullResponse);
          
          // Only send text before if it's meaningful (not just whitespace)
          if (textBefore && textBefore.trim()) {
            // Send any meaningful text that appeared before the tool call
            yield this.createStreamChunk(conversationId, textBefore, request.model);
          }

          // Yield the tool call chunk and finish the stream
          yield this.createToolCallStreamChunk(conversationId, toolCall, request.model);
          yield this.createStreamChunk(conversationId, '', request.model, 'tool_calls');
          return; // End the stream - client will handle tool execution
        } else if (toolCallDetected && bufferedChunks.length > 0) {
          // If we thought it was a tool call but it wasn't, stream the buffered content
          for (const bufferedChunk of bufferedChunks) {
            yield this.createStreamChunk(conversationId, bufferedChunk, request.model);
          }
        }
      }

      yield this.createStreamChunk(conversationId, '', request.model, 'stop');
      return;
    }

    throw new Error(`Maximum conversation rounds (${this.config.maxRounds}) exceeded`);
  }

  private injectToolSystemPrompt(messages: Message[], toolPrompt: string): Message[] {
    const systemMessage = messages.find(m => m.role === 'system');
    
    if (systemMessage) {
      systemMessage.content = `${systemMessage.content || ''}\n\n${toolPrompt}`;
      return messages;
    }

    return [
      { role: 'system', content: toolPrompt },
      ...messages
    ];
  }

  private prepareMessagesForTarget(messages: Message[]): Message[] {
    return messages.map(msg => {
      if (msg.role === 'tool') {
        return this.toolConverter.convertToolMessageToUserMessage(msg);
      }
      
      if (msg.tool_calls) {
        // Don't use a hardcoded message that might trigger tool extraction
        // Instead, pass the original content or a more descriptive message
        return {
          role: msg.role,
          content: msg.content || `Calling function: ${msg.tool_calls[0].function.name}`,
        };
      }
      
      return {
        role: msg.role,
        content: msg.content || '',
      };
    });
  }

  private async callTargetLLM(messages: Message[], request: ChatCompletionRequest, tools: Tool[] = [], requestId: string): Promise<string> {
    const headers: any = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const payload = {
      model: this.config.targetModel,
      messages,
      temperature: request.temperature,
      max_tokens: request.max_tokens,
      stream: false,
    };

    // Log request to LLM
    this.logger.logProxyToLLM(requestId, this.config.targetApiUrl, headers, payload);

    try {
      const response = await axios.post(this.config.targetApiUrl, payload, { headers });
      
      // Log response from LLM
      this.logger.logLLMResponse(requestId, response.status, response.headers, response.data);
      
      // Check for error responses
      if (response.data.error) {
        throw new Error(`Target LLM error: ${response.data.error.message || 'Unknown error'}`);
      }
      
      // Handle OpenAI-compatible response format
      if (response.data.choices?.[0]?.message?.content !== undefined) {
        const content = response.data.choices[0].message.content || '';
        // If empty response, provide a fallback
        if (!content) {
          return 'I received an empty response from the model. Please try again.';
        }
        return content;
      } else if (response.data.response) {
        return response.data.response;
      } else if (response.data.message?.content) {
        return response.data.message.content;
      } else if (typeof response.data === 'string') {
        return response.data;
      }
      
      throw new Error('Unexpected response format from target LLM');
    } catch (error: any) {
      this.logger.logError(requestId, error, 'callTargetLLM');
      throw error;
    }
  }

  private async *streamTargetLLM(
    messages: Message[],
    request: ChatCompletionRequest,
    requestId: string
  ): AsyncGenerator<string> {
    const headers: any = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const payload = {
      model: this.config.targetModel,
      messages,
      temperature: request.temperature,
      max_tokens: request.max_tokens,
      stream: true,
    };

    // Log streaming request to LLM
    this.logger.logProxyToLLM(requestId, this.config.targetApiUrl, headers, payload);

    try {
      const response = await axios.post(this.config.targetApiUrl, payload, {
        headers,
        responseType: 'stream',
      });

      for await (const chunk of this.streamHandler.parseStream(response.data)) {
        yield chunk;
      }
    } catch (error: any) {
      this.logger.logError(requestId, error, 'streamTargetLLM');
      throw error;
    }
  }

  private createCompletionResponse(
    id: string,
    content: string,
    model: string
  ): ChatCompletionResponse {
    return {
      id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    };
  }

  private createToolCallResponse(
    id: string,
    toolCall: ToolCall,
    textBefore: string,
    model: string
  ): ChatCompletionResponse {
    return {
      id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: textBefore || null,
            tool_calls: [toolCall],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    };
  }

  private createStreamChunk(
    id: string,
    content: string,
    model: string,
    finishReason: string | null = null
  ): StreamChunk {
    return {
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          delta: content ? { content } : {},
          finish_reason: finishReason,
        },
      ],
    };
  }

  private createToolCallStreamChunk(
    id: string,
    toolCall: ToolCall,
    model: string
  ): StreamChunk {
    return {
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              id: toolCall.id,
              type: toolCall.type,
              function: toolCall.function
            }],
          } as any,
          finish_reason: null,
        },
      ],
    };
  }
}