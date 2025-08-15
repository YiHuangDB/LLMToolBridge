import axios from 'axios';
import { ChatCompletionRequest, Tool } from '../src/types';

const PROXY_URL = 'http://localhost:3000/v1/chat/completions';

const weatherTool: Tool = {
  type: 'function',
  function: {
    name: 'get_current_weather',
    description: 'Get the current weather in a given location',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'The city and state, e.g. San Francisco, CA',
        },
        unit: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
        },
      },
      required: ['location'],
    },
  },
};

const calculatorTool: Tool = {
  type: 'function',
  function: {
    name: 'calculate',
    description: 'Perform mathematical calculations',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'The mathematical expression to evaluate',
        },
      },
      required: ['expression'],
    },
  },
};

async function testNonStreamingWithTools() {
  console.log('\\n=== Testing Non-Streaming Request with Tools ===');
  
  const request: ChatCompletionRequest = {
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'user',
        content: 'What is the weather like in New York? Also, what is 25 * 4?',
      },
    ],
    tools: [weatherTool, calculatorTool],
    stream: false,
  };

  try {
    const response = await axios.post(PROXY_URL, request);
    console.log('Response:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

async function testStreamingWithTools() {
  console.log('\\n=== Testing Streaming Request with Tools ===');
  
  const request: ChatCompletionRequest = {
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'user',
        content: 'Tell me the weather in London and calculate 100 / 5',
      },
    ],
    tools: [weatherTool, calculatorTool],
    stream: true,
  };

  try {
    const response = await axios.post(PROXY_URL, request, {
      responseType: 'stream',
    });

    response.data.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            console.log('\\nStream completed');
          } else {
            try {
              const parsed = JSON.parse(data);
              if (parsed.choices?.[0]?.delta?.content) {
                process.stdout.write(parsed.choices[0].delta.content);
              }
              if (parsed.choices?.[0]?.delta?.tool_calls) {
                console.log('\\nTool call:', JSON.stringify(parsed.choices[0].delta.tool_calls));
              }
            } catch (e) {
            }
          }
        }
      }
    });

    await new Promise((resolve) => {
      response.data.on('end', resolve);
    });
  } catch (error) {
    console.error('Error:', error);
  }
}

async function testWithoutTools() {
  console.log('\\n=== Testing Request without Tools ===');
  
  const request: ChatCompletionRequest = {
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'user',
        content: 'Tell me a short joke about programming',
      },
    ],
    stream: false,
  };

  try {
    const response = await axios.post(PROXY_URL, request);
    console.log('Response:', response.data.choices[0].message.content);
  } catch (error) {
    console.error('Error:', error);
  }
}

async function runTests() {
  console.log('Starting LLM Tool Bridge tests...');
  console.log('Make sure the proxy server is running on port 3000');
  console.log('================================================');

  await testWithoutTools();
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  await testNonStreamingWithTools();
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  await testStreamingWithTools();
}

runTests().catch(console.error);