import { Readable } from 'stream';
import { createParser, ParsedEvent, ReconnectInterval } from 'eventsource-parser';

export class StreamHandler {
  async *parseStream(stream: Readable): AsyncGenerator<string> {
    let buffer = '';
    
    for await (const chunk of stream) {
      const text = chunk.toString();
      buffer += text;
      
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        const content = this.extractContent(line);
        if (content) {
          yield content;
        }
      }
    }
    
    if (buffer) {
      const content = this.extractContent(buffer);
      if (content) {
        yield content;
      }
    }
  }

  private extractContent(line: string): string | null {
    const trimmed = line.trim();
    
    if (!trimmed || trimmed === 'data: [DONE]') {
      return null;
    }
    
    if (trimmed.startsWith('data: ')) {
      try {
        const json = JSON.parse(trimmed.slice(6));
        
        if (json.response !== undefined) {
          return json.response;
        }
        
        if (json.choices?.[0]?.delta?.content) {
          return json.choices[0].delta.content;
        }
        
        if (json.choices?.[0]?.message?.content) {
          return json.choices[0].message.content;
        }
        
        if (json.message?.content) {
          return json.message.content;
        }
        
        if (json.content) {
          return json.content;
        }
        
        if (typeof json === 'string') {
          return json;
        }
      } catch (error) {
        console.error('Failed to parse streaming data:', error);
      }
    }
    
    try {
      const json = JSON.parse(trimmed);
      
      if (json.response !== undefined) {
        return json.response;
      }
      
      if (json.choices?.[0]?.delta?.content) {
        return json.choices[0].delta.content;
      }
      
      if (json.message?.content) {
        return json.message.content;
      }
    } catch {
    }
    
    return null;
  }

  async *parseSSEStream(stream: Readable): AsyncGenerator<string> {
    let results: any[] = [];
    
    const parser = createParser((event: ParsedEvent | ReconnectInterval) => {
      if (event.type === 'event') {
        const data = event.data;
        
        if (data === '[DONE]') {
          return;
        }
        
        try {
          const json = JSON.parse(data);
          results.push(json);
        } catch (error) {
          console.error('Failed to parse SSE event:', error);
        }
      }
    });

    for await (const chunk of stream) {
      parser.feed(chunk.toString());
      
      while (results.length > 0) {
        const result = results.shift();
        const content = this.extractContentFromSSE(result);
        if (content) {
          yield content;
        }
      }
    }
  }

  private extractContentFromSSE(data: any): string | null {
    if (!data) return null;
    
    if (data.choices?.[0]?.delta?.content) {
      return data.choices[0].delta.content;
    }
    
    if (data.choices?.[0]?.message?.content) {
      return data.choices[0].message.content;
    }
    
    if (data.delta?.content) {
      return data.delta.content;
    }
    
    if (data.message?.content) {
      return data.message.content;
    }
    
    if (data.content) {
      return data.content;
    }
    
    if (data.response) {
      return data.response;
    }
    
    return null;
  }

  combineChunks(chunks: string[]): string {
    return chunks.join('');
  }

  async collectStream(stream: AsyncGenerator<string>): Promise<string> {
    const chunks: string[] = [];
    
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    
    return this.combineChunks(chunks);
  }
}