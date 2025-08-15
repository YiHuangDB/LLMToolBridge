import { Tool, Message, ToolCall } from './types';

export class ToolConverter {
  convertToolsToSystemPrompt(tools: Tool[]): string {
    if (!tools || tools.length === 0) {
      return '';
    }

    let prompt = 'You are a helpful assistant. You can help me by answering my questions. You can also ask me questions.\n\n';
    prompt += 'here are list of functions start with <<< end with >>>:\n<<<\n';
    
    tools.forEach((tool) => {
      prompt += `Function: ${tool.function.name}\n`;
      prompt += `Description: ${tool.function.description}\n`;
      
      if (tool.function.parameters) {
        prompt += `Parameters: ${JSON.stringify(tool.function.parameters, null, 2)}\n`;
      }
      
      prompt += '\n';
    });

    prompt += '>>>\n';
    prompt += `To use a function, you MUST respond with ONLY a valid JSON object in the following format, with no additional text, markdown formatting, or code blocks:
follow this format:
{
  "function_call": {
    "name": "function_name",
    "arguments": {
      "param1": "value1",
      "param2": "value2"
    }
  }
}

IMPORTANT: 
- Output ONLY the raw JSON object, only contains function_call, name, arguments, and parameters required, no additional properties.
- Do NOT wrap the JSON in code blocks (no \`\`\`)
- Do NOT include any explanatory text before or after the JSON
- Ensure the JSON is valid and properly formatted
- Ensure only JSON is returned, no additional text before or after json.
- After receiving the function result, you can continue the conversation normally
check with user prompt with functions above, if above function can be used solve user question, response with pure json follow function example.
If you don't need to use a function, just respond normally without JSON.`;

    return prompt;
  }

  extractToolCallFromResponse(response: string): ToolCall | null {
    let jsonContent = null;
    
    // First, try to find raw JSON (preferred approach)
    const trimmedResponse = response.trim();
    
    // Skip extraction if this is just a mention without actual JSON
    if (trimmedResponse === 'I need to call a function.' || 
        trimmedResponse === 'I need to call a function') {
      return null;
    }
    
    // Check if the entire response is just JSON
    if (trimmedResponse.startsWith('{') && trimmedResponse.endsWith('}')) {
      jsonContent = trimmedResponse;
    } else {
      // Try to extract complete JSON object with proper bracket matching
      // This finds JSON starting with { and ending with the matching }
      let braceCount = 0;
      let startIdx = -1;
      let endIdx = -1;
      
      for (let i = 0; i < response.length; i++) {
        if (response[i] === '{') {
          if (startIdx === -1) {
            startIdx = i;
          }
          braceCount++;
        } else if (response[i] === '}') {
          braceCount--;
          if (braceCount === 0 && startIdx !== -1) {
            endIdx = i + 1;
            const potentialJson = response.substring(startIdx, endIdx);
            // Check if this JSON contains function_call
            if (potentialJson.includes('function_call')) {
              jsonContent = potentialJson;
              break;
            }
          }
        }
      }
    }
    
    // Fallback: If no raw JSON found, try code blocks (for backward compatibility)
    if (!jsonContent) {
      const codeBlockPatterns = [
        /```\s*json\s*([\s\S]*?)```/i,  // Matches ```json or ``` json (case insensitive)
        /```\s*([\s\S]*?)```/            // Matches ``` with no language specified
      ];
      
      for (const pattern of codeBlockPatterns) {
        const match = response.match(pattern);
        if (match) {
          jsonContent = match[1].trim();
          console.warn('Tool call found in code block. Consider updating LLM to return raw JSON.');
          break;
        }
      }
    }
    
    if (!jsonContent) {
      return null;
    }

    try {
      const parsed = JSON.parse(jsonContent);
      
      if (parsed.function_call && parsed.function_call.name) {
        return {
          id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'function',
          function: {
            name: parsed.function_call.name,
            arguments: JSON.stringify(parsed.function_call.arguments || {}),
          },
        };
      }
    } catch (error) {
      console.error('Failed to parse tool call from response:', error);
      console.error('JSON content that failed to parse:', jsonContent);
    }

    return null;
  }

  formatToolResponse(toolCallId: string, functionName: string, result: any): Message {
    return {
      role: 'tool',
      content: typeof result === 'string' ? result : JSON.stringify(result),
      tool_call_id: toolCallId,
      name: functionName,
    };
  }

  convertToolMessageToUserMessage(toolMessage: Message): Message {
    // Extract function name from tool_call_id if name is not provided
    const functionName = toolMessage.name || 'tool';
    return {
      role: 'user',
      content: `Function "${functionName}" returned: ${toolMessage.content || ''}`,
    };
  }

  shouldAttemptToolExtraction(response: string): boolean {
    // Check for function_call keyword
    const hasFunctionCall = response.includes('function_call');
    // Check for typical function call structure
    const hasNameField = response.includes('"name"') && response.includes('"arguments"');
    // Avoid triggering on messages that just mention needing to call a function
    const isJustMention = response.trim() === 'I need to call a function.' || 
                         response.trim() === 'I need to call a function';
    
    // We should attempt extraction if we see signs of a function call
    // but not if it's just a mention without actual JSON
    return (hasFunctionCall || hasNameField) && !isJustMention;
  }

  extractTextBeforeToolCall(response: string): string {
    // Match any code block format
    const codeBlockRegex = /```[\s\S]*?```/;
    const match = response.match(codeBlockRegex);
    
    if (match && match.index !== undefined) {
      return response.substring(0, match.index).trim();
    }
    
    // Also check for raw JSON
    const rawJsonRegex = /\{[\s\S]*?"function_call"[\s\S]*?\}/;
    const jsonMatch = response.match(rawJsonRegex);
    
    if (jsonMatch && jsonMatch.index !== undefined) {
      return response.substring(0, jsonMatch.index).trim();
    }
    
    return response;
  }

  extractTextAfterToolCall(response: string): string {
    // Match any code block format
    const codeBlockRegex = /```[\s\S]*?```/;
    const match = response.match(codeBlockRegex);
    
    if (match && match.index !== undefined) {
      const endIndex = match.index + match[0].length;
      return response.substring(endIndex).trim();
    }
    
    return '';
  }

  createToolCallMessage(toolCall: ToolCall, textBefore?: string): Message {
    const message: Message = {
      role: 'assistant',
      content: textBefore || '',
      tool_calls: [toolCall],
    };
    
    return message;
  }
}