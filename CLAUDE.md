# CLAUDE.md - Development Guidelines

## Process Management - Universal Guidelines

### CRITICAL: Never Kill All Processes

**IMPORTANT:** When working in ANY environment or project, **NEVER** use commands that kill all instances of a process type. Always identify and terminate only the specific process that needs to be stopped.

### ❌ Commands to AVOID (These kill ALL instances):
```bash
# NEVER USE THESE:
killall node           # Linux/Mac - kills ALL Node processes
pkill node            # Linux/Mac - kills ALL Node processes  
taskkill /IM node.exe # Windows - kills ALL Node processes
killall python        # Kills ALL Python processes
pkill -f java        # Kills ALL Java processes
```

### ✅ Correct Process Management Approach

#### Step 1: Identify the Specific Process

**For Node.js processes:**
```bash
# Windows
tasklist | findstr node
wmic process where "name='node.exe'" get ProcessId,CommandLine

# Linux/Mac
ps aux | grep node
pgrep -fl node
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

#### Step 3: Kill ONLY the Specific Process

```bash
# Windows (using specific PID)
taskkill /PID <process_id> /F

# Linux/Mac (using specific PID)
kill <process_id>        # Graceful shutdown (SIGTERM)
kill -15 <process_id>    # Explicit SIGTERM
kill -9 <process_id>     # Force kill (SIGKILL) - use as last resort
```

### Universal Best Practices

1. **Always use PID (Process ID):** Target processes by their unique PID, never by name alone
2. **Graceful shutdown first:** 
   - Try Ctrl+C in the terminal
   - Use SIGTERM (kill -15) before SIGKILL (kill -9)
3. **Verify before killing:** Double-check you have the right process
4. **Check for child processes:** Some applications spawn children that may need separate handling
5. **Document which process:** Note what process/port you're killing for future reference

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