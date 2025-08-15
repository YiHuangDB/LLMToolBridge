# CLAUDE.md - Development Guidelines

## Process Management - Universal Guidelines

### CRITICAL: Never Kill All Processes - ESPECIALLY Node.js

**⚠️ ABSOLUTELY FORBIDDEN:** **NEVER** use commands that kill all instances of a process type. This is particularly critical for Node.js processes. You MUST only kill processes by their specific Process ID (PID).

**Node.js Process Management Rule:**
- **NEVER** kill all Node.js processes
- **ALWAYS** identify the specific PID first
- **ONLY** terminate the exact process you need to stop

### ❌ Commands to AVOID (These kill ALL instances):
```bash
# NEVER USE THESE - ABSOLUTELY FORBIDDEN:
killall node           # ❌ NEVER: Kills ALL Node.js processes system-wide
pkill node            # ❌ NEVER: Kills ALL Node.js processes system-wide
taskkill /IM node.exe # ❌ NEVER: Kills ALL Node.js processes on Windows
taskkill /IM node.exe /F # ❌ NEVER: Force kills ALL Node.js processes

# Also avoid for other languages:
killall python        # ❌ Kills ALL Python processes
pkill -f java        # ❌ Kills ALL Java processes
```

### ✅ Correct Process Management Approach

#### Step 1: Identify the Specific Process

**For Node.js processes (CRITICAL - Always use PID):**
```bash
# Windows - Find the SPECIFIC Node.js process
tasklist | findstr node
wmic process where "name='node.exe'" get ProcessId,CommandLine
# Note the PID (Process ID) - you will ONLY kill by this number

# Linux/Mac - Find the SPECIFIC Node.js process  
ps aux | grep node
pgrep -fl node
# Note the PID (first number after username) - you will ONLY kill by this number
```

**For Python processes:**
```bash
# Windows
tasklist | findstr python
wmic process where "name='python.exe'" get ProcessId,CommandLine

# Linux/Mac
ps aux | grep python
pgrep -fl python
```

**For Java processes:**
```bash
# Windows
tasklist | findstr java
wmic process where "name='java.exe'" get ProcessId,CommandLine

# Linux/Mac
ps aux | grep java
jps -l  # Java-specific command
```

#### Step 2: Find Process by Port (if applicable)

```bash
# Windows
netstat -ano | findstr :<PORT>
# Example: netstat -ano | findstr :3000

# Linux
lsof -i :<PORT>
netstat -tulpn | grep :<PORT>
# Example: lsof -i :8080

# Mac
lsof -i :<PORT>
netstat -anv | grep <PORT>
```

#### Step 3: Kill ONLY the Specific Process BY PID

**⚠️ CRITICAL FOR NODE.JS:** Only use the specific PID number, NEVER the process name!

```bash
# Windows (MUST use specific PID - replace <process_id> with actual number)
taskkill /PID <process_id> /F
# Example: taskkill /PID 12345 /F  # ✅ CORRECT - kills only PID 12345
# NEVER: taskkill /IM node.exe     # ❌ WRONG - kills ALL Node processes

# Linux/Mac (MUST use specific PID - replace <process_id> with actual number)
kill <process_id>        # Graceful shutdown (SIGTERM)
kill -15 <process_id>    # Explicit SIGTERM  
kill -9 <process_id>     # Force kill (SIGKILL) - use as last resort
# Example: kill 12345     # ✅ CORRECT - kills only PID 12345
# NEVER: killall node     # ❌ WRONG - kills ALL Node processes
```

### Universal Best Practices

1. **🔴 MANDATORY - Always use PID (Process ID):** Target processes by their unique PID, NEVER by name alone
   - For Node.js: ONLY kill by PID, NEVER use `killall node` or `taskkill /IM node.exe`
2. **Graceful shutdown first:** 
   - Try Ctrl+C in the terminal
   - Use SIGTERM (kill -15) before SIGKILL (kill -9)
3. **Verify before killing:** Double-check you have the right process
4. **Check for child processes:** Some applications spawn children that may need separate handling
5. **Document which process:** Note what process/port you're killing for future reference
6. **Node.js specific:** Remember that killing all Node processes can break other running applications, system services, and development tools

### Common Scenarios

#### Web Development Servers
```bash
# Find process on port 3000
lsof -i :3000  # Mac/Linux
netstat -ano | findstr :3000  # Windows

# Kill specific process
kill <PID>  # Use the PID from above
```

#### Database Processes
```bash
# PostgreSQL
ps aux | grep postgres
# Kill specific postgres process, not all

# MongoDB
ps aux | grep mongod
# Kill specific mongod process, not all
```

#### Docker Containers
```bash
# List containers
docker ps

# Stop specific container
docker stop <container_id>

# Never use: docker kill $(docker ps -q)  # This kills ALL containers
```

### For This Project (LLMToolBridge)

## Testing

Before running tests, ensure no conflicting processes are running on the required ports:
```bash
npm test
```

## Development Server

To run the development server:
```bash
npm run dev
```

To build the project:
```bash
npm run build
```

## Linting and Type Checking

Run these commands to ensure code quality:
```bash
npm run lint
npm run typecheck
```