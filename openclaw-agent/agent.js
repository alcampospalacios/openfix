/**
 * Openfix Agent — Bridge between backend and OpenClaw gateway
 *
 * This agent receives crash reports from the backend via WebSocket,
 * sends them to OpenClaw gateway for AI-powered analysis and fixing,
 * then commits the results and creates pull requests.
 *
 * If OpenClaw gateway is unavailable, falls back to direct API calls.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// ── Configuration ───────────────────────────────────────────────────────────
const CONFIG = {
  backendUrl: process.env.BACKEND_URL || 'http://backend:3000',
  openclawUrl: process.env.OPENCLAW_URL || 'ws://openclaw:18789',
  openclawToken: process.env.OPENCLAW_TOKEN || 'openfix-token',
  heartbeatInterval: 180000,
  maxAgentTurns: 25,
  maxFileLines: 500,
};

let currentConfig = {
  githubToken: '',
  githubRepo: '',
  model: 'minimax/MiniMax-M2.5',
  apiKey: ''
};

let wsConnection = null;
let heartbeatTimer = null;
let openclawAvailable = null; // null = unknown, true/false after first check

const repoDir = '/tmp/openfix-repo';

// ── HTTP request helper ─────────────────────────────────────────────────────
function makeRequest(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const lib = urlObj.protocol === 'https:' ? require('https') : require('http');
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers }
    };
    const req = lib.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve({ raw: body }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(JSON.stringify(data));
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ── OpenClaw Gateway Client ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

function sendToOpenClaw(task) {
  return new Promise((resolve, reject) => {
    const wsUrl = CONFIG.openclawUrl;
    console.log(`   [openclaw] Connecting to ${wsUrl}...`);

    const oc = new WebSocket(wsUrl, {
      headers: { 'Authorization': `Bearer ${CONFIG.openclawToken}` }
    });

    let result = null;
    const timeout = setTimeout(() => {
      oc.close();
      reject(new Error('OpenClaw task timed out after 5 minutes'));
    }, 300000);

    oc.on('open', () => {
      console.log(`   [openclaw] Connected, sending task...`);
      oc.send(JSON.stringify({
        type: 'task',
        task: {
          message: task.message,
          thinking: task.thinking || 'high',
          model: task.model || undefined,
          apiKey: task.apiKey || undefined,
          workspace: task.workspace || undefined,
        }
      }));
    });

    oc.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'progress') {
          console.log(`   [openclaw] ${msg.data?.message || 'working...'}`);
        } else if (msg.type === 'tool_call') {
          console.log(`   [openclaw] tool: ${msg.data?.name}(${JSON.stringify(msg.data?.input || {}).substring(0, 80)})`);
        } else if (msg.type === 'result') {
          result = msg.data;
          console.log(`   [openclaw] Task completed`);
          clearTimeout(timeout);
          oc.close();
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          oc.close();
          reject(new Error(`OpenClaw error: ${msg.data?.message || 'Unknown error'}`));
        }
      } catch (err) {
        console.error(`   [openclaw] Parse error: ${err.message}`);
      }
    });

    oc.on('close', () => {
      clearTimeout(timeout);
      if (result) resolve(result);
      else reject(new Error('OpenClaw connection closed without result'));
    });

    oc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`OpenClaw connection error: ${err.message}`));
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Direct Provider Fallback (when OpenClaw gateway is unavailable) ──────
// ═══════════════════════════════════════════════════════════════════════════

function parseModel(modelStr) {
  const slash = modelStr.indexOf('/');
  if (slash === -1) return { provider: 'openai', modelId: modelStr };
  return {
    provider: modelStr.substring(0, slash).toLowerCase(),
    modelId: modelStr.substring(slash + 1)
  };
}

const PROVIDER_CONFIG = {
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
  },
  minimax: {
    endpoint: 'https://api.minimax.io/v1/text/chatcompletion_v2',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
  },
  openrouter: {
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
  },
  google: {
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
  },
  deepseek: {
    endpoint: 'https://api.deepseek.com/chat/completions',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
  },
  anthropic: {
    endpoint: 'https://api.anthropic.com/v1/messages',
    authHeader: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
  },
};

const AGENT_TOOLS = [
  {
    name: 'list_directory',
    description: 'List files and directories at a given path. Use "." for root.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative path from repo root.' } },
      required: ['path']
    }
  },
  {
    name: 'read_file',
    description: 'Read file contents with line numbers.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative path to file.' } },
      required: ['path']
    }
  },
  {
    name: 'search_code',
    description: 'Search for text pattern across repo files.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text or regex pattern.' },
        file_extension: { type: 'string', description: 'Optional extension filter, e.g. "dart".' }
      },
      required: ['query']
    }
  },
  {
    name: 'write_file',
    description: 'Write or overwrite a file with new content.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to file.' },
        content: { type: 'string', description: 'Complete new file content.' }
      },
      required: ['path', 'content']
    }
  }
];

const filesModified = new Set();

function executeTool(name, input) {
  try {
    switch (name) {
      case 'list_directory': {
        const fullPath = path.resolve(repoDir, input.path);
        if (!fs.existsSync(fullPath)) return `Directory not found: ${input.path}`;
        const entries = fs.readdirSync(fullPath, { withFileTypes: true });
        return entries
          .filter(e => !e.name.startsWith('.') || e.name === '.github')
          .map(e => `${e.isDirectory() ? '[dir]' : '[file]'} ${e.name}`)
          .join('\n') || '(empty directory)';
      }
      case 'read_file': {
        const fullPath = path.resolve(repoDir, input.path);
        if (!fs.existsSync(fullPath)) return `File not found: ${input.path}`;
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) return `Error: ${input.path} is a directory.`;
        if (stat.size > 200000) return `File too large (${stat.size} bytes).`;
        const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
        const limited = lines.slice(0, CONFIG.maxFileLines);
        let result = limited.map((l, i) => `${i + 1}: ${l}`).join('\n');
        if (lines.length > CONFIG.maxFileLines) result += `\n\n... (truncated, ${CONFIG.maxFileLines}/${lines.length} lines)`;
        return result;
      }
      case 'search_code': {
        let cmd = `grep -rn "${input.query.replace(/"/g, '\\"')}" .`;
        if (input.file_extension) cmd += ` --include="*.${input.file_extension}"`;
        cmd += ' | head -50';
        try {
          return execSync(cmd, { cwd: repoDir, encoding: 'utf8', timeout: 10000 }) || 'No matches found.';
        } catch (e) {
          return e.status === 1 ? 'No matches found.' : `Search error: ${e.message}`;
        }
      }
      case 'write_file': {
        const fullPath = path.resolve(repoDir, input.path);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, input.content);
        filesModified.add(input.path);
        return `File written: ${input.path} (${input.content.split('\n').length} lines)`;
      }
      default: return `Unknown tool: ${name}`;
    }
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

function formatToolsForProvider(provider, tools) {
  if (provider === 'anthropic') {
    return tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  }
  return tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

function buildRequestBody(provider, modelId, messages, tools) {
  const formattedTools = formatToolsForProvider(provider, tools);

  if (provider === 'anthropic') {
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');
    const anthropicMsgs = [];
    for (const msg of nonSystemMsgs) {
      if (msg.role === 'tool') {
        const last = anthropicMsgs[anthropicMsgs.length - 1];
        const toolResult = { type: 'tool_result', tool_use_id: msg.tool_call_id, content: msg.content };
        if (last && last.role === 'user' && Array.isArray(last.content)) {
          last.content.push(toolResult);
        } else {
          anthropicMsgs.push({ role: 'user', content: [toolResult] });
        }
      } else if (msg.role === 'assistant' && msg.tool_calls) {
        const blocks = [];
        if (msg.content) blocks.push({ type: 'text', text: msg.content });
        for (const tc of msg.tool_calls) {
          let inp = tc.function?.arguments || '{}';
          if (typeof inp === 'string') { try { inp = JSON.parse(inp); } catch { inp = {}; } }
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.function?.name, input: inp });
        }
        anthropicMsgs.push({ role: 'assistant', content: blocks });
      } else {
        anthropicMsgs.push(msg);
      }
    }
    return { model: modelId, max_tokens: 8192, system: systemMsg?.content || '', messages: anthropicMsgs, tools: formattedTools };
  }

  return { model: modelId, messages, tools: formattedTools, max_tokens: 8192 };
}

function parseResponse(provider, response) {
  if (response.error) {
    const errMsg = typeof response.error === 'string' ? response.error : response.error.message || JSON.stringify(response.error);
    throw new Error(`API error: ${errMsg}`);
  }
  if (response.base_resp?.status_code && response.base_resp.status_code !== 0) {
    throw new Error(`API error: ${response.base_resp.status_msg}`);
  }

  if (provider === 'anthropic') {
    const content = response.content || [];
    let text = null;
    const toolCalls = [];
    for (const block of content) {
      if (block.type === 'text' && block.text) text = (text || '') + block.text;
      else if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, input: block.input || {} });
    }
    return { text, toolCalls };
  }

  const choice = response.choices?.[0];
  if (!choice) throw new Error('No choices in API response');
  const message = choice.message || {};
  let text = (message.content && typeof message.content === 'string' && message.content.trim()) ? message.content : null;
  const toolCalls = [];
  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      let inp = tc.function?.arguments || '{}';
      if (typeof inp === 'string') { try { inp = JSON.parse(inp); } catch { inp = {}; } }
      toolCalls.push({
        id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: tc.function?.name || tc.name,
        input: inp
      });
    }
  }
  return { text, toolCalls };
}

async function callAI(messages, tools) {
  const apiKey = currentConfig.apiKey;
  if (!apiKey) throw new Error('No API key configured.');
  const { provider, modelId } = parseModel(currentConfig.model);
  const providerCfg = PROVIDER_CONFIG[provider];
  if (!providerCfg) throw new Error(`Unknown provider: ${provider}`);
  const endpoint = typeof providerCfg.endpoint === 'function' ? providerCfg.endpoint(modelId, apiKey) : providerCfg.endpoint;
  const headers = providerCfg.authHeader(apiKey);
  const body = buildRequestBody(provider, modelId, messages, tools);
  const response = await makeRequest(endpoint, body, headers);
  return parseResponse(provider, response);
}

async function callAISimple(systemPrompt, userMessage) {
  const apiKey = currentConfig.apiKey;
  if (!apiKey) throw new Error('No API key configured');
  const { provider, modelId } = parseModel(currentConfig.model);
  const providerCfg = PROVIDER_CONFIG[provider];
  if (!providerCfg) throw new Error(`Unknown provider: ${provider}`);
  const endpoint = typeof providerCfg.endpoint === 'function' ? providerCfg.endpoint(modelId, apiKey) : providerCfg.endpoint;
  const headers = providerCfg.authHeader(apiKey);

  let body;
  if (provider === 'anthropic') {
    body = { model: modelId, max_tokens: 512, system: systemPrompt, messages: [{ role: 'user', content: userMessage }] };
  } else {
    body = { model: modelId, max_tokens: 512, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }] };
  }

  const response = await makeRequest(endpoint, body, headers);
  if (provider === 'anthropic') {
    const text = response.content?.[0]?.text;
    if (text) return text;
    if (response.error) throw new Error(response.error.message || JSON.stringify(response.error));
    throw new Error('No response from Anthropic');
  }
  const content = response.choices?.[0]?.message?.content;
  if (content) return content;
  if (response.error) throw new Error(response.error.message || JSON.stringify(response.error));
  if (response.base_resp?.status_msg) throw new Error(response.base_resp.status_msg);
  throw new Error(`Unexpected response: ${JSON.stringify(response).substring(0, 200)}`);
}

async function runAgentLoop(crash) {
  filesModified.clear();

  let crashContext = `## Crash Report\n`;
  crashContext += `- **ID**: ${crash.id}\n- **Title**: ${crash.title}\n`;
  crashContext += `- **Description**: ${crash.description || 'N/A'}\n- **Severity**: ${crash.severity || 'ERROR'}\n`;
  if (crash.stacktrace) crashContext += `\n## Stacktrace\n\`\`\`\n${crash.stacktrace}\n\`\`\`\n`;
  if (crash.blame_file) {
    crashContext += `\n## Blame Info\n- **File**: ${crash.blame_file}\n`;
    if (crash.blame_line) crashContext += `- **Line**: ${crash.blame_line}\n`;
    if (crash.blame_symbol) crashContext += `- **Symbol**: ${crash.blame_symbol}\n`;
  }
  if (crash.exception_class) crashContext += `- **Exception**: ${crash.exception_class}\n`;
  if (crash.device) crashContext += `- **Device**: ${crash.device}\n`;
  if (crash.os_version) crashContext += `- **OS**: ${crash.os_version}\n`;
  if (crash.version) crashContext += `- **App Version**: ${crash.version}\n`;
  crashContext += `\nInvestigate this crash in the repository, find the root cause, and fix it. Start by exploring the project structure.`;

  const systemPrompt = `You are an expert software debugger and coding agent. You have access to a code repository via tools.

Your job:
1. Explore the repository structure to understand the project
2. Find and read the source files related to the crash
3. Analyze the root cause based on the crash report, stacktrace, and code
4. Write a fix by modifying the appropriate file(s) using the write_file tool

Guidelines:
- Start by listing the root directory to understand the project layout
- If a blame_file is provided, read that file first
- Read related files to understand the context (imports, dependencies)
- When you write a fix, write the COMPLETE file content (not just the changed part)
- Make minimal, focused changes — only fix what's needed
- After writing the fix, explain what you changed and why in your final message

IMPORTANT: You MUST use the write_file tool to apply your fix. Do not just describe changes — actually write them.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: crashContext }
  ];

  let explanation = '';

  for (let turn = 0; turn < CONFIG.maxAgentTurns; turn++) {
    console.log(`   Agent turn ${turn + 1}/${CONFIG.maxAgentTurns}`);
    const result = await callAI(messages, AGENT_TOOLS);
    const { text, toolCalls } = result;

    if (text) {
      explanation = text;
      console.log(`   [text] ${text.substring(0, 150)}...`);
    }
    for (const tc of toolCalls) {
      console.log(`   [tool] ${tc.name}(${JSON.stringify(tc.input).substring(0, 100)})`);
    }

    if (toolCalls.length === 0) {
      console.log(`   Agent finished after ${turn + 1} turns`);
      break;
    }

    const toolResults = [];
    for (const tc of toolCalls) {
      const res = executeTool(tc.name, tc.input);
      console.log(`   [result] ${tc.name} → ${res.substring(0, 80)}${res.length > 80 ? '...' : ''}`);
      toolResults.push({ id: tc.id, result: res });
    }

    // Add to conversation history
    const assistantMsg = { role: 'assistant', content: text || '' };
    if (toolCalls.length > 0) {
      assistantMsg.tool_calls = toolCalls.map(tc => ({
        id: tc.id, type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.input) }
      }));
    }
    messages.push(assistantMsg);
    for (const tr of toolResults) {
      messages.push({ role: 'tool', tool_call_id: tr.id, content: tr.result });
    }
  }

  return { explanation: explanation || 'Agent completed without text explanation.', filesModified: [...filesModified] };
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Smart dispatch: OpenClaw first, fallback to direct ──────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if OpenClaw gateway is reachable (cached after first check).
 */
async function checkOpenClawAvailability() {
  if (openclawAvailable !== null) return openclawAvailable;

  return new Promise((resolve) => {
    const oc = new WebSocket(CONFIG.openclawUrl, {
      headers: { 'Authorization': `Bearer ${CONFIG.openclawToken}` }
    });
    const timer = setTimeout(() => {
      oc.terminate();
      openclawAvailable = false;
      console.log('   [openclaw] Gateway not reachable — using direct API fallback');
      resolve(false);
    }, 3000);

    oc.on('open', () => {
      clearTimeout(timer);
      oc.close();
      openclawAvailable = true;
      console.log('   [openclaw] Gateway available');
      resolve(true);
    });
    oc.on('error', () => {
      clearTimeout(timer);
      openclawAvailable = false;
      console.log('   [openclaw] Gateway not reachable — using direct API fallback');
      resolve(false);
    });
  });
}

/** Reset availability check (e.g. after config change). */
function resetOpenClawCheck() {
  openclawAvailable = null;
}

// ── WebSocket to backend ────────────────────────────────────────────────────
function connectWebSocket() {
  const wsUrl = CONFIG.backendUrl.replace('http', 'ws') + '/ws/agent';
  console.log(`Connecting WebSocket: ${wsUrl}`);

  wsConnection = new WebSocket(wsUrl);

  wsConnection.on('open', () => {
    console.log('WebSocket connected');
    wsSend('heartbeat', { status: 'running' });
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      wsSend('heartbeat', { status: 'running' });
      console.log('Heartbeat sent');
    }, CONFIG.heartbeatInterval);
  });

  wsConnection.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const { event, data } = msg;

      if (event === 'new_crash') {
        console.log(`New crash received via WS: ${data.id}`);
        await processCrash(data);
      } else if (event === 'test_message') {
        console.log(`Test message received: ${data.text}`);
        await loadConfig();
        resetOpenClawCheck();
        const reply = await processTestMessage(data.text);
        wsSend('test_response', { messageId: data.id, response: reply });
      }
    } catch (err) {
      console.error('WS message error:', err.message);
    }
  });

  wsConnection.on('close', () => {
    console.log('WebSocket disconnected, reconnecting in 5s...');
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    setTimeout(() => connectWebSocket(), 5000);
  });

  wsConnection.on('error', (err) => {
    console.error('WebSocket error:', err.message);
    wsConnection.close();
  });
}

function wsSend(event, data) {
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    wsConnection.send(JSON.stringify({ event, data }));
  }
}

// ── Test message ────────────────────────────────────────────────────────────
async function processTestMessage(text) {
  const model = currentConfig.model;
  const apiKey = currentConfig.apiKey;

  if (!apiKey) {
    return `Error: No API key configured.\n\nRepo: ${currentConfig.githubRepo || 'Not set'}\nModel: ${model}\n\nSet your API key in Config to enable AI.`;
  }

  const useOpenClaw = await checkOpenClawAvailability();

  if (useOpenClaw) {
    console.log(`   Sending test message via OpenClaw (model: ${model})...`);
    try {
      const result = await sendToOpenClaw({
        message: `Respond concisely in the same language the user writes: "${text}"`,
        thinking: 'low',
        model: model,
        apiKey: apiKey,
      });
      const responseText = result?.text || result?.explanation || 'No response';
      return `${responseText}\n\n— ${model} (via OpenClaw)`;
    } catch (err) {
      console.log(`   OpenClaw failed, falling back to direct: ${err.message}`);
      openclawAvailable = false;
    }
  }

  // Direct fallback
  const { provider } = parseModel(model);
  console.log(`   Calling ${model} (${provider}) directly...`);
  try {
    const responseText = await callAISimple(
      'You are a helpful assistant. Respond concisely in the same language the user writes.',
      text
    );
    return `${responseText}\n\n— ${model}`;
  } catch (err) {
    return `API Error: ${err.message}\n\nModel: ${model}\nProvider: ${provider}\nCheck your API key in Config.`;
  }
}

// ── Config ──────────────────────────────────────────────────────────────────
async function loadConfig() {
  try {
    const response = await fetch(`${CONFIG.backendUrl}/api/agent/config`);
    const config = await response.json();

    const keys = Object.keys(config);
    if (keys.length > 0) {
      const repoId = keys[0];
      currentConfig = {
        githubToken: config[repoId].github_token || '',
        githubRepo: config[repoId].github_repo || '',
        model: config[repoId].model || 'minimax/MiniMax-M2.5',
        apiKey: config[repoId].api_key || ''
      };

      const { provider, modelId } = parseModel(currentConfig.model);
      console.log(`Config loaded:`);
      console.log(`   - Repo: ${currentConfig.githubRepo}`);
      console.log(`   - Provider: ${provider} | Model: ${modelId}`);
      console.log(`   - API Key: ${currentConfig.apiKey ? '***' + currentConfig.apiKey.slice(-4) : '(empty)'}`);
      console.log(`   - OpenClaw: ${CONFIG.openclawUrl}`);
    }
  } catch (error) {
    console.log('No config yet, waiting for setup...');
  }
}

// ── Git operations ──────────────────────────────────────────────────────────
async function ensureRepoCloned() {
  if (!currentConfig.githubRepo || !currentConfig.githubToken) {
    throw new Error('GitHub not configured');
  }

  if (!fs.existsSync(repoDir)) {
    console.log(`Cloning ${currentConfig.githubRepo}...`);
    const repoUrl = `https://${currentConfig.githubToken}@github.com/${currentConfig.githubRepo}.git`;
    execSync(`git clone ${repoUrl} ${repoDir}`, { stdio: 'inherit' });
  } else {
    console.log('Repository exists, resetting to latest main...');
    execSync('git checkout main --force', { cwd: repoDir, stdio: 'inherit' });
    execSync('git clean -fd', { cwd: repoDir, stdio: 'inherit' });
    execSync('git pull origin main', { cwd: repoDir, stdio: 'inherit' });
  }
  return repoDir;
}

async function createFixBranch(branchName) {
  try { execSync(`git branch -D ${branchName}`, { cwd: repoDir, stdio: 'ignore' }); } catch (_) {}
  execSync(`git checkout -b ${branchName}`, { cwd: repoDir, stdio: 'inherit' });
  return branchName;
}

async function commitAndPush(branchName, crash, explanation) {
  const status = execSync('git status --porcelain', { cwd: repoDir, encoding: 'utf8' });
  if (!status.trim()) {
    throw new Error('Agent finished but made no file changes. The model may need a different approach.');
  }
  const commitMsg = `fix(${crash.id}): ${explanation.substring(0, 100)}`.replace(/"/g, "'");
  execSync('git add .', { cwd: repoDir, stdio: 'inherit' });
  execSync(`git commit -m "${commitMsg}"`, { cwd: repoDir, stdio: 'inherit' });
  execSync(`git push -u origin ${branchName}`, {
    cwd: repoDir, stdio: 'inherit',
    env: { ...process.env, GIT_ASKPASS: '/bin/true' }
  });
}

async function createPullRequest(branchName, crash, explanation) {
  try {
    const [owner, repo] = currentConfig.githubRepo.split('/');
    const { provider, modelId } = parseModel(currentConfig.model);
    const prBody = {
      title: `Fix: ${crash.title.substring(0, 80)}`,
      head: branchName,
      base: 'main',
      body: `## Crash Fix\n\n**Crash ID**: ${crash.id}\n**Title**: ${crash.title}\n\n## Root Cause Analysis\n\n${explanation.substring(0, 2000)}\n\n---\n*Auto-generated by Openfix Agent using ${provider}/${modelId}*`
    };
    const response = await makeRequest(
      `https://api.github.com/repos/${owner}/${repo}/pulls`,
      prBody,
      {
        'Authorization': `token ${currentConfig.githubToken}`,
        'User-Agent': 'OpenClaw-Agent',
        'Accept': 'application/vnd.github.v3+json'
      }
    );
    if (response.html_url) return response.html_url;
    return `https://github.com/${currentConfig.githubRepo}/compare/${branchName}?expand=1`;
  } catch (e) {
    return `https://github.com/${currentConfig.githubRepo}/compare/${branchName}?expand=1`;
  }
}

// ── Crash processing (orchestrator) ─────────────────────────────────────────
async function processCrash(crash) {
  await loadConfig();
  resetOpenClawCheck();

  const { provider, modelId } = parseModel(currentConfig.model);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing crash: ${crash.id}`);
  console.log(`   Title: ${crash.title}`);
  console.log(`   Provider: ${provider} | Model: ${modelId}`);
  console.log(`   OpenClaw: ${CONFIG.openclawUrl}`);
  console.log('='.repeat(60));

  const steps = [
    { id: 'cloning', label: 'Clone repository' },
    { id: 'analyzing', label: 'AI analyzing & fixing' },
    { id: 'branching', label: 'Create fix branch' },
    { id: 'pushing', label: 'Commit & push' },
    { id: 'pr', label: 'Create Pull Request' },
  ];

  function sendProgress(stepId, status, message) {
    wsSend('crash_progress', {
      crashId: crash.id, step: stepId, status, message, steps,
    });
  }

  try {
    // Step 1: Clone/update repo
    sendProgress('cloning', 'running', 'Preparing repository...');
    await ensureRepoCloned();
    sendProgress('cloning', 'success', 'Repository ready');

    // Step 2: AI analysis — try OpenClaw, fallback to direct
    const useOpenClaw = await checkOpenClawAvailability();
    let explanation, modified;

    if (useOpenClaw) {
      sendProgress('analyzing', 'running', `OpenClaw agent working (${provider}/${modelId})...`);

      let crashContext = `## Crash Report\n`;
      crashContext += `- **ID**: ${crash.id}\n- **Title**: ${crash.title}\n`;
      crashContext += `- **Description**: ${crash.description || 'N/A'}\n- **Severity**: ${crash.severity || 'ERROR'}\n`;
      if (crash.stacktrace) crashContext += `\n## Stacktrace\n\`\`\`\n${crash.stacktrace}\n\`\`\`\n`;
      if (crash.blame_file) {
        crashContext += `\n## Blame Info\n- **File**: ${crash.blame_file}\n`;
        if (crash.blame_line) crashContext += `- **Line**: ${crash.blame_line}\n`;
        if (crash.blame_symbol) crashContext += `- **Symbol**: ${crash.blame_symbol}\n`;
      }
      if (crash.exception_class) crashContext += `- **Exception**: ${crash.exception_class}\n`;
      if (crash.device) crashContext += `- **Device**: ${crash.device}\n`;
      if (crash.os_version) crashContext += `- **OS**: ${crash.os_version}\n`;
      if (crash.version) crashContext += `- **App Version**: ${crash.version}\n`;
      crashContext += `\nThe repository is at: ${repoDir}\n`;
      crashContext += `\nInvestigate this crash in the repository, find the root cause, and fix it. Start by exploring the project structure.`;

      try {
        const result = await sendToOpenClaw({
          message: crashContext,
          thinking: 'high',
          model: currentConfig.model,
          apiKey: currentConfig.apiKey,
          workspace: repoDir,
        });
        explanation = result?.text || result?.explanation || 'Agent completed without explanation.';
        modified = result?.filesModified || [];
      } catch (err) {
        console.log(`   OpenClaw failed, falling back to direct: ${err.message}`);
        openclawAvailable = false;
        // Fall through to direct mode below
      }
    }

    if (!explanation) {
      // Direct fallback
      sendProgress('analyzing', 'running', `AI agent working (${provider}/${modelId})...`);
      const result = await runAgentLoop(crash);
      explanation = result.explanation;
      modified = result.filesModified;
    }

    sendProgress('analyzing', 'success', `Done — ${(modified || []).length || 'some'} file(s) modified`);

    // Step 3: Create branch
    const branchName = `fix/${crash.id}`;
    sendProgress('branching', 'running', `Creating branch ${branchName}...`);
    await createFixBranch(branchName);
    sendProgress('branching', 'success', `Branch created`);

    // Step 4: Commit & push
    sendProgress('pushing', 'running', 'Committing and pushing...');
    await commitAndPush(branchName, crash, explanation);
    sendProgress('pushing', 'success', `Pushed ${(modified || []).length} file(s)`);

    // Step 5: Create PR
    sendProgress('pr', 'running', 'Creating Pull Request...');
    const prUrl = await createPullRequest(branchName, crash, explanation);
    sendProgress('pr', 'success', `PR created: ${prUrl}`);

    await updateCrashStatus(crash.id, 'fixed', prUrl);
    console.log(`\nCrash ${crash.id} fixed! PR: ${prUrl}\n`);

  } catch (error) {
    console.error(`Failed: ${error.message}`);
    wsSend('crash_progress', {
      crashId: crash.id, step: 'error', status: 'error', message: error.message, steps,
    });
    await updateCrashStatus(crash.id, 'failed', null, error.message);
  }
}

async function checkForCrashes() {
  await loadConfig();
  try {
    const response = await fetch(`${CONFIG.backendUrl}/api/crashes?status=pending`);
    const crashes = await response.json();
    if (crashes.length > 0) {
      console.log(`Found ${crashes.length} pending crash(es)`);
      for (const crash of crashes) {
        await processCrash(crash);
      }
    }
  } catch (error) {
    console.error('Error checking crashes:', error.message);
  }
}

async function updateCrashStatus(crashId, status, prUrl = null, error = null) {
  wsSend('crash_update', { crashId, status, prUrl, error });
  try {
    await fetch(`${CONFIG.backendUrl}/api/crashes/${crashId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, prUrl, error })
    });
  } catch (err) {
    console.error('Failed to update status via HTTP:', err.message);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function startAgent() {
  console.log('Openfix Agent starting...');
  console.log(`Backend: ${CONFIG.backendUrl}`);
  console.log(`OpenClaw Gateway: ${CONFIG.openclawUrl}`);
  console.log(`Supported providers (fallback): ${Object.keys(PROVIDER_CONFIG).join(', ')}`);

  await loadConfig();
  await checkOpenClawAvailability();
  connectWebSocket();
  await checkForCrashes();
}

startAgent();
