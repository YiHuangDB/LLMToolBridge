# LLM Tool Bridge

A proxy server that enables OpenAI-style function calling for Large Language Models (LLMs) that don't natively support tools. This bridge converts OpenAI's tool/function calling format into prompts that any LLM can understand and process.

## Features

- **Universal Tool Support**: Adds OpenAI-compatible function calling to any LLM
- **Tool Conversion**: Converts OpenAI-style tool definitions into natural language prompts
- **Multi-Round Orchestration**: Manages multiple conversation rounds to handle tool calls and responses
- **Streaming Support**: Full support for streaming responses with tool call detection
- **Web Interface**: Built-in testing interface for easy experimentation
- **Flexible Backend**: Works with any LLM API (Ollama, OpenRouter, local models, etc.)
- **Mock Tool Implementations**: Includes example tools for testing (weather, calculator, web search)

## Architecture

```
┌─────────────┐       ┌─────────────┐       ┌──────────────┐
│   Client    │──────▶│  LLM Proxy  │──────▶│  Target LLM  │
│ (with tools)│       │   Bridge    │       │ (no tools)   │
└─────────────┘       └─────────────┘       └──────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │ Tool Executor │
                    └───────────────┘
```

## Workflow

1. **Client Request**: Client sends request with tool definitions
2. **Prompt Injection**: Proxy converts tools to instructions in system prompt
3. **LLM Response**: Target LLM responds with text (possibly including tool call JSON)
4. **Tool Detection**: Proxy parses response for tool call patterns
5. **Tool Execution**: If tool call detected, proxy executes and adds result to conversation
6. **Multi-Round**: Process repeats until no more tool calls or max rounds reached
7. **Final Response**: Complete response sent back to client

## Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/llm-tool-bridge.git
cd llm-tool-bridge

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
```

### Configuration

Edit the `.env` file with your LLM backend details:

```env
# Port for the proxy server
PORT=3500

# Target LLM API endpoint (examples below)
TARGET_LLM_API=http://localhost:8000/v1/chat/completions
TARGET_LLM_MODEL=your-model-name

# API key for target LLM (if required)
TARGET_LLM_API_KEY=your-api-key

# Optional: Custom system prompt for tool conversion
TOOL_SYSTEM_PROMPT=
```

### Supported Target LLMs

- **OpenRouter**: `https://openrouter.ai/api/v1/chat/completions`
- **Ollama**: `http://localhost:11434/v1/chat/completions`
- **LM Studio**: `http://localhost:1234/v1/chat/completions`
- **Together AI**: `https://api.together.xyz/v1/chat/completions`
- **Any OpenAI-compatible endpoint**: Following OpenAI's chat format
- **Custom APIs**: Modify `stream-handler.ts` for custom response formats

## Usage

### Start the Server

```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm run build
npm start
```

### Test with Web Interface

Open your browser and navigate to:
```
http://localhost:3500
```

The web interface provides:
- Visual test panel with configuration options
- Toggle for enabling/disabling tools
- Streaming/non-streaming modes
- Real-time message log
- Pre-configured test tools (weather, calculator, web search)

### API Examples

#### Using cURL

```bash
# Basic message without tools
curl -X POST http://localhost:3500/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "your-model",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ],
    "stream": false
  }'

# With function calling
curl -X POST http://localhost:3500/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "your-model",
    "messages": [
      {"role": "user", "content": "What is the weather in Paris?"}
    ],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get the current weather",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string"}
          },
          "required": ["location"]
        }
      }
    }],
    "stream": false
  }'
```

#### Using OpenAI Python Client

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3500/v1",
    api_key="your-api-key"  # Use same key as configured in .env
)

response = client.chat.completions.create(
    model="your-model",
    messages=[
        {"role": "user", "content": "What's the weather in Paris?"}
    ],
    tools=[{
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get the current weather",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string"}
                },
                "required": ["location"]
            }
        }
    }]
)
```

#### Using Node.js/TypeScript

```typescript
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://localhost:3500/v1',
  apiKey: 'your-api-key',
});

const response = await openai.chat.completions.create({
  model: 'your-model',
  messages: [
    { role: 'user', content: 'Calculate 25 + 17' }
  ],
  tools: [{
    type: 'function',
    function: {
      name: 'calculator',
      description: 'Perform arithmetic operations',
      parameters: {
        type: 'object',
        properties: {
          operation: { 
            type: 'string', 
            enum: ['add', 'subtract', 'multiply', 'divide'] 
          },
          a: { type: 'number' },
          b: { type: 'number' }
        },
        required: ['operation', 'a', 'b']
      }
    }
  }]
});
```

## How It Works

### Tool-to-Prompt Conversion

Tools are converted into instructions:

```
You have access to the following functions:

Function: get_current_weather
Description: Get the current weather in a given location
Parameters: {
  "type": "object",
  "properties": {
    "location": {"type": "string"}
  }
}

To use a function, respond with a JSON block:
```json
{
  "function_call": {
    "name": "get_current_weather",
    "arguments": {"location": "Paris"}
  }
}
```
```

### Multi-Round Example

**Round 1:**
- User: "What's the weather in NYC?"
- LLM: "I'll check the weather... ```json {\"function_call\": ...} ```"
- Proxy: Executes tool, adds result to conversation

**Round 2:**
- Proxy: "Function returned: {temperature: 72, ...}"
- LLM: "The weather in NYC is 72°F and partly cloudy."
- Proxy: Returns final response to client

## Customization

### Adding Custom Tools

Edit `src/tool-executor.ts`:

```typescript
this.registerTool('my_custom_tool', async (args: any) => {
  // Your implementation
  return { result: 'success' };
});
```

### External Tool Endpoints

The proxy can call external tool endpoints:

```typescript
const result = await toolExecutor.executeExternalTool(
  toolCall,
  'https://api.example.com/tools',
  'api-key'
);
```

## API Endpoints

- `POST /v1/chat/completions` - OpenAI-compatible chat endpoint
- `GET /health` - Health check

## Limitations

- Maximum conversation rounds configurable (default: 10)
- Tool call detection relies on specific JSON format in LLM response
- Some LLMs may need fine-tuning of the tool instruction prompt

## Project Structure

```
llm-tool-bridge/
├── src/
│   ├── index.ts           # Express server setup
│   ├── proxy-handler.ts   # Main proxy logic
│   ├── tool-converter.ts  # Tool↔Prompt conversion
│   ├── tool-executor.ts   # Tool execution logic
│   ├── stream-handler.ts  # Streaming response handler
│   └── types.ts          # TypeScript definitions
├── public/
│   └── index.html        # Web testing interface
├── examples/
│   └── client.ts         # Example client implementation
├── test/
│   └── *.test.ts        # Test files
├── .env.example         # Environment template
├── package.json         # Dependencies
└── tsconfig.json       # TypeScript config
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode with auto-reload
npm run dev

# Build TypeScript for production
npm run build

# Run tests
npm test

# Run with coverage
npm run test:coverage
```

## Testing

The project includes comprehensive tests and example scripts:

```bash
# Run the test suite
npm test

# Test with a simple script
node test_proxy.js

# Test streaming
node test_streaming.js
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Troubleshooting

### Empty Responses
If the LLM returns empty responses when tools are provided, it may not understand the tool instructions. Try:
- Adjusting the `TOOL_SYSTEM_PROMPT` in `.env`
- Using a more capable model
- Simplifying tool descriptions

### Tool Detection Issues
If tool calls aren't being detected:
- Ensure the LLM is outputting valid JSON in code blocks
- Check the tool conversion prompt format
- Verify the LLM understands the instructions

### Connection Errors
- Verify the `TARGET_LLM_API` is accessible
- Check if API key is required and correctly set
- Ensure the target API follows OpenAI's format

## License

MIT License - see LICENSE file for details

## Acknowledgments

- Built with TypeScript, Express, and Axios
- Inspired by OpenAI's function calling specification
- Designed for maximum compatibility with various LLM providers