import { ToolConverter } from '../tool-converter';
import { Tool, ToolCall } from '../types';

describe('ToolConverter', () => {
  let converter: ToolConverter;

  beforeEach(() => {
    converter = new ToolConverter();
  });

  describe('convertToolsToSystemPrompt', () => {
    it('should convert tools to system prompt', () => {
      const tools: Tool[] = [
        {
          type: 'function',
          function: {
            name: 'test_function',
            description: 'A test function',
            parameters: {
              type: 'object',
              properties: {
                param1: { type: 'string' },
              },
              required: ['param1'],
            },
          },
        },
      ];

      const prompt = converter.convertToolsToSystemPrompt(tools);
      expect(prompt).toContain('Function: test_function');
      expect(prompt).toContain('Description: A test function');
      expect(prompt).toContain('Parameters:');
      expect(prompt).toContain('function_call');
    });

    it('should return empty string for no tools', () => {
      const prompt = converter.convertToolsToSystemPrompt([]);
      expect(prompt).toBe('');
    });
  });

  describe('extractToolCallFromResponse', () => {
    it('should extract tool call from response with JSON block', () => {
      const response = `I'll help you with that.
\`\`\`json
{
  "function_call": {
    "name": "test_function",
    "arguments": {
      "param1": "value1"
    }
  }
}
\`\`\``;

      const toolCall = converter.extractToolCallFromResponse(response);
      expect(toolCall).not.toBeNull();
      expect(toolCall?.function.name).toBe('test_function');
      expect(JSON.parse(toolCall?.function.arguments || '{}')).toEqual({
        param1: 'value1',
      });
    });

    it('should return null for response without tool call', () => {
      const response = 'This is a regular response without any function calls.';
      const toolCall = converter.extractToolCallFromResponse(response);
      expect(toolCall).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      const response = '\`\`\`json\\ninvalid json content\\n\`\`\`';
      const toolCall = converter.extractToolCallFromResponse(response);
      expect(toolCall).toBeNull();
    });
  });

  describe('extractTextBeforeToolCall', () => {
    it('should extract text before JSON block', () => {
      const response = 'Let me check that for you.\\n\`\`\`json\\n{}\`\`\`\\nDone!';
      const text = converter.extractTextBeforeToolCall(response);
      expect(text).toBe('Let me check that for you.');
    });

    it('should return full text if no JSON block', () => {
      const response = 'This is a regular response.';
      const text = converter.extractTextBeforeToolCall(response);
      expect(text).toBe(response);
    });
  });

  describe('shouldAttemptToolExtraction', () => {
    it('should return true for response with JSON block and function_call', () => {
      const response = '\`\`\`json\\n{"function_call": {}}\`\`\`';
      expect(converter.shouldAttemptToolExtraction(response)).toBe(true);
    });

    it('should return false for response without indicators', () => {
      const response = 'Regular text response';
      expect(converter.shouldAttemptToolExtraction(response)).toBe(false);
    });
  });
});