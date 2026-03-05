/**
 * Openfix Agent
 * Handles crash analysis and auto-fix generation
 * Supports multiple AI models
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// Configuration
const CONFIG = {
  backendUrl: process.env.BACKEND_URL || 'http://backend:3000',
  heartbeatInterval: 180000,       // Send heartbeat every 3 minutes
};

// Current config
let currentConfig = {
  githubToken: '',
  githubRepo: '',
  model: 'minimax/MiniMax-M2.5',
  apiKey: ''
};

// WebSocket connection
let wsConnection = null;
let heartbeatTimer = null;
let reconnectTimer = null;

/**
 * Make HTTP request to AI API
 */
function makeAiRequest(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const lib = isHttps ? require('https') : require('http');
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers }
    };
    
    const req = lib.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } 
        catch { resolve({ error: body }); }
      });
    });
    
    req.on('error', reject);
    req.write(JSON.stringify(data));
    req.end();
  });
}

/**
 * Main agent loop
 */
async function startAgent() {
  console.log('Openfix Agent starting...');
  console.log(`Backend: ${CONFIG.backendUrl}`);

  await loadConfig();

  // Connect via WebSocket
  connectWebSocket();

  // Initial catch-up: check for any pending crashes
  await checkForCrashes();
}

/**
 * Connect to backend via WebSocket
 */
function connectWebSocket() {
  const wsUrl = CONFIG.backendUrl.replace('http', 'ws') + '/ws/agent';
  console.log(`Connecting WebSocket: ${wsUrl}`);

  wsConnection = new WebSocket(wsUrl);

  wsConnection.on('open', () => {
    console.log('WebSocket connected');
    // Send initial heartbeat
    wsSend('heartbeat', { status: 'running' });
    // Start heartbeat interval
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
        const reply = processTestMessage(data.text);
        wsSend('test_response', { messageId: data.id, response: reply });
        console.log(`Response sent: ${reply}`);
      }
    } catch (err) {
      console.error('WS message error:', err.message);
    }
  });

  wsConnection.on('close', () => {
    console.log('WebSocket disconnected, reconnecting in 5s...');
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    reconnectTimer = setTimeout(() => connectWebSocket(), 5000);
  });

  wsConnection.on('error', (err) => {
    console.error('WebSocket error:', err.message);
    wsConnection.close();
  });
}

/**
 * Send message via WebSocket
 */
function wsSend(event, data) {
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    wsConnection.send(JSON.stringify({ event, data }));
  }
}

/**
 * Process test message and generate response
 */
function processTestMessage(text) {
  const lower = text.toLowerCase();

  if (lower.includes('hola') || lower.includes('hello') || lower.includes('hi')) {
    return `Hola! Estoy funcionando correctamente.\n\nModelo: ${currentConfig.model}\nRepo: ${currentConfig.githubRepo || 'No configurado'}\nHora: ${new Date().toLocaleString()}`;
  }

  if (lower.includes('status') || lower.includes('estado')) {
    return `Estado: Running\nModelo: ${currentConfig.model}\nRepo: ${currentConfig.githubRepo || 'No configurado'}`;
  }

  if (lower.includes('help') || lower.includes('ayuda')) {
    return `Comandos disponibles:\n- hola/hello/hi: Saludar\n- status/estado: Ver estado\n- help/ayuda: Ver comandos`;
  }

  return `Mensaje recibido: "${text}"\n\nEstoy funcionando! Usa "help" para ver comandos disponibles.`;
}

/**
 * Send heartbeat to backend - HTTP fallback
 */
async function sendHeartbeat() {
  try {
    await fetch(`${CONFIG.backendUrl}/api/agent/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'running'
      })
    });
  } catch (error) {
    console.log('Failed to send heartbeat:', error.message);
  }
}

/**
 * Load configuration from backend
 */
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

      console.log(`Config loaded:`);
      console.log(`   - Repo: ${currentConfig.githubRepo}`);
      console.log(`   - Model: ${currentConfig.model}`);
    }
  } catch (error) {
    console.log('No config yet, waiting for setup...');
  }
}

/**
 * Check for pending crashes
 */
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

/**
 * Process a single crash
 */
async function processCrash(crash) {
  // Reload config before each crash to pick up any changes
  await loadConfig();

  console.log(`Processing crash: ${crash.id}`);
  console.log(`   Title: ${crash.title}`);
  console.log(`   Model: ${currentConfig.model}`);

  const steps = [
    { id: 'cloning', label: 'Clone repository' },
    { id: 'analyzing', label: 'Analyze crash with AI' },
    { id: 'branching', label: 'Create fix branch' },
    { id: 'fixing', label: 'Apply fix' },
    { id: 'pushing', label: 'Push changes' },
    { id: 'pr', label: 'Create Pull Request' },
  ];

  function sendProgress(stepId, status, message) {
    wsSend('crash_progress', {
      crashId: crash.id,
      step: stepId,
      status,  // 'running' | 'success' | 'error'
      message,
      steps,
    });
  }

  try {
    sendProgress('cloning', 'running', 'Preparing repository...');
    const repoDir = await ensureRepoCloned();
    sendProgress('cloning', 'success', 'Repository ready (latest main)');

    sendProgress('analyzing', 'running', `Analyzing crash with ${currentConfig.model}...`);
    const analysis = await analyzeCrashWithAI(crash, repoDir);
    sendProgress('analyzing', 'success', 'Analysis complete');

    const branchName = `fix/${crash.id}`;
    sendProgress('branching', 'running', `Creating branch ${branchName}...`);
    await createFixBranch(branchName);
    sendProgress('branching', 'success', `Branch ${branchName} created`);

    sendProgress('fixing', 'running', 'Applying fix to codebase...');
    await applyFix(branchName, crash, analysis, repoDir);
    sendProgress('fixing', 'success', 'Fix applied and committed');

    sendProgress('pushing', 'running', 'Pushing to remote...');
    // push is inside applyFix, so mark success directly
    sendProgress('pushing', 'success', 'Changes pushed');

    sendProgress('pr', 'running', 'Creating Pull Request...');
    const prUrl = await createPullRequest(branchName, crash);
    sendProgress('pr', 'success', `PR created: ${prUrl}`);

    await updateCrashStatus(crash.id, 'fixed', prUrl);

    console.log(`Crash ${crash.id} fixed!`);
    console.log(`   PR: ${prUrl}`);

  } catch (error) {
    console.error(`Failed:`, error.message);
    // Find the current step that was running and mark it as error
    wsSend('crash_progress', {
      crashId: crash.id,
      step: 'error',
      status: 'error',
      message: error.message,
      steps,
    });
    await updateCrashStatus(crash.id, 'failed', null, error.message);
  }
}

/**
 * Analyze crash and generate fix using AI
 */
async function analyzeCrashWithAI(crash, repoDir) {
  const relevantFiles = await findRelevantFiles(crash, repoDir);

  const context = {
    crash: {
      id: crash.id,
      title: crash.title,
      description: crash.description,
      severity: crash.severity
    },
    relevantFiles: relevantFiles.slice(0, 5),
    model: currentConfig.model
  };

  let fix = '';

  switch (currentConfig.model) {
    case 'minimax/MiniMax-M2.5':
      fix = await generateFixWithMiniMax(context);
      break;
    case 'openai/gpt-4o':
      fix = await generateFixWithOpenAI(context);
      break;
    case 'anthropic/claude-3.5-sonnet':
      fix = await generateFixWithClaude(context);
      break;
    case 'google/gemini-2.0-flash':
      fix = await generateFixWithGemini(context);
      break;
    default:
      fix = await generateFixWithMiniMax(context);
  }

  return fix;
}

/**
 * Generate fix using MiniMax
 */
async function generateFixWithMiniMax(context) {
  console.log(`   Using MiniMax M2.5...`);
  const apiKey = currentConfig.apiKey;
  
  if (!apiKey) {
    return { error: 'No API key configured', explanation: 'Configure API key in settings', fixes: [] };
  }
  
  const { crash, relevantFiles } = context;
  
  // Build files context
  let filesContext = '';
  for (const file of relevantFiles.slice(0, 3)) {
    try {
      const content = fs.readFileSync(file.path, 'utf8').slice(0, 3000);
      filesContext += `\n\nFile: ${file.path}\n\`\`\`\n${content}\n\`\`\``;
    } catch (e) {}
  }
  
  const prompt = `You are an expert Flutter/Dart developer.

## Crash
- Title: ${crash.title}
- Description: ${crash.description || 'No description'}
- Severity: ${crash.severity}

## Files
${filesContext}

Provide fix as JSON:
{
  "explanation": "root cause",
  "fixes": [{"file": "path", "original": "code", "fixed": "fixed", "description": "desc"}]
}`;

  try {
    const response = await makeAiRequest(
      'https://api.minimax.chat/v1/text/chatcompletion_pro_2',
      { model: 'MiniMax-M2.5', messages: [{ role: 'user', content: prompt }], temperature: 0.7 },
      { 'Authorization': `Bearer ${apiKey}` }
    );
    
    if (response.choices?.[0]?.message?.content) {
      const content = response.choices[0].message.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
      return { explanation: content, fixes: [] };
    }
    return { error: response.error || 'Unknown error', fixes: [] };
  } catch (err) {
    return { error: err.message, fixes: [] };
  }
}

/**
 * Generate fix using OpenAI
 */
async function generateFixWithOpenAI(context) {
  console.log(`   Using GPT-4o...`);
  const apiKey = currentConfig.apiKey;
  
  if (!apiKey) {
    return { error: 'No API key configured', explanation: 'Configure API key in settings', fixes: [] };
  }
  
  const { crash, relevantFiles } = context;
  
  let filesContext = '';
  for (const file of relevantFiles.slice(0, 3)) {
    try {
      const content = fs.readFileSync(file.path, 'utf8').slice(0, 3000);
      filesContext += `\n\nFile: ${file.path}\n\`\`\`\n${content}\n\`\`\``;
    } catch (e) {}
  }
  
  const prompt = `You are an expert Flutter/Dart developer.

## Crash
- Title: ${crash.title}
- Description: ${crash.description || 'No description'}
- Severity: ${crash.severity}

## Files
${filesContext}

Provide fix as JSON:
{
  "explanation": "root cause",
  "fixes": [{"file": "path", "original": "code", "fixed": "fixed", "description": "desc"}]
}`;

  try {
    const response = await makeAiRequest(
      'https://api.openai.com/v1/chat/completions',
      { model: 'gpt-4o', messages: [{ role: 'user', content: prompt }], temperature: 0.7 },
      { 'Authorization': `Bearer ${apiKey}` }
    );
    
    if (response.choices?.[0]?.message?.content) {
      const content = response.choices[0].message.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
      return { explanation: content, fixes: [] };
    }
    return { error: response.error?.message || 'Unknown error', fixes: [] };
  } catch (err) {
    return { error: err.message, fixes: [] };
  }
}

/**
 * Generate fix using Claude
 */
async function generateFixWithClaude(context) {
  console.log(`   Using Claude 3.5...`);
  const apiKey = currentConfig.apiKey;
  
  if (!apiKey) {
    return { error: 'No API key configured', explanation: 'Configure API key in settings', fixes: [] };
  }
  
  const { crash, relevantFiles } = context;
  
  let filesContext = '';
  for (const file of relevantFiles.slice(0, 3)) {
    try {
      const content = fs.readFileSync(file.path, 'utf8').slice(0, 3000);
      filesContext += `\n\nFile: ${file.path}\n\`\`\`\n${content}\n\`\`\``;
    } catch (e) {}
  }
  
  const prompt = `You are an expert Flutter/Dart developer.

## Crash
- Title: ${crash.title}
- Description: ${crash.description || 'No description'}
- Severity: ${crash.severity}

## Files
${filesContext}

Provide fix as JSON:
{
  "explanation": "root cause",
  "fixes": [{"file": "path", "original": "code", "fixed": "fixed", "description": "desc"}]
}`;

  try {
    const response = await makeAiRequest(
      'https://api.anthropic.com/v1/messages',
      { model: 'claude-3-5-sonnet-20241022', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] },
      { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    );
    
    if (response.content?.[0]?.text) {
      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
      return { explanation: text, fixes: [] };
    }
    return { error: response.error?.message || 'Unknown error', fixes: [] };
  } catch (err) {
    return { error: err.message, fixes: [] };
  }
}

/**
 * Generate fix using Gemini
 */
async function generateFixWithGemini(context) {
  console.log(`   Using Gemini 2.0...`);
  const apiKey = currentConfig.apiKey;
  
  if (!apiKey) {
    return { error: 'No API key configured', explanation: 'Configure API key in settings', fixes: [] };
  }
  
  const { crash, relevantFiles } = context;
  
  let filesContext = '';
  for (const file of relevantFiles.slice(0, 3)) {
    try {
      const content = fs.readFileSync(file.path, 'utf8').slice(0, 3000);
      filesContext += `\n\nFile: ${file.path}\n\`\`\`\n${content}\n\`\`\``;
    } catch (e) {}
  }
  
  const prompt = `You are an expert Flutter/Dart developer.

## Crash
- Title: ${crash.title}
- Description: ${crash.description || 'No description'}
- Severity: ${crash.severity}

## Files
${filesContext}

Provide fix as JSON:
{
  "explanation": "root cause",
  "fixes": [{"file": "path", "original": "code", "fixed": "fixed", "description": "desc"}]
}`;

  try {
    const response = await makeAiRequest(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 2000 } },
      {}
    );
    
    if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
      const text = response.candidates[0].content.parts[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
      return { explanation: text, fixes: [] };
    }
    return { error: response.error?.message || 'Unknown error', fixes: [] };
  } catch (err) {
    return { error: err.message, fixes: [] };
  }
}

/**
 * Find relevant files in the repo
 */
async function findRelevantFiles(crash, repoDir) {
  const files = [];

  try {
    const keywords = crash.title.toLowerCase()
      .replace(/[^a-z0-9]/g, ' ')
      .split(' ')
      .filter(k => k.length > 3)
      .slice(0, 3);

    // Search for Dart files (Flutter), plus common mobile files
    const searchCmd = `find ${repoDir} -type f \( -name "*.dart" -o -name "*.kt" -o -name "*.swift" -o -name "*.java" \) 2>/dev/null | head -30`;
    const result = execSync(searchCmd, { encoding: 'utf8' });

    const allFiles = result.trim().split('\n');

    for (const file of allFiles) {
      for (const keyword of keywords) {
        if (file.toLowerCase().includes(keyword)) {
          // Store full path relative to repo
      files.push({ path: file, name: path.basename(file) });
          break;
        }
      }
    }
  } catch (e) {
    console.log('   Could not search files');
  }

  return files;
}

/**
 * Ensure repository is cloned and clean on main with latest changes
 */
async function ensureRepoCloned() {
  const repoDir = '/tmp/openfix-repo';

  if (!currentConfig.githubRepo || !currentConfig.githubToken) {
    throw new Error('GitHub not configured');
  }

  if (!fs.existsSync(repoDir)) {
    console.log(`Cloning ${currentConfig.githubRepo}...`);
    const repoUrl = `https://${currentConfig.githubToken}@github.com/${currentConfig.githubRepo}.git`;
    execSync(`git clone ${repoUrl} ${repoDir}`, { stdio: 'inherit' });
  } else {
    // Repo already exists — discard any local changes and update main
    console.log('Repository exists, resetting to latest main...');
    execSync('git checkout main --force', { cwd: repoDir, stdio: 'inherit' });
    execSync('git clean -fd', { cwd: repoDir, stdio: 'inherit' });
    execSync('git pull origin main', { cwd: repoDir, stdio: 'inherit' });
  }

  return repoDir;
}

/**
 * Create fix branch from current clean main
 */
async function createFixBranch(branchName) {
  const repoDir = '/tmp/openfix-repo';

  // Delete branch if it somehow already exists locally
  try {
    execSync(`git branch -D ${branchName}`, { cwd: repoDir, stdio: 'ignore' });
  } catch (_) {
    // Branch didn't exist, that's fine
  }

  execSync(`git checkout -b ${branchName}`, { cwd: repoDir, stdio: 'inherit' });

  return branchName;
}

/**
 * Apply fix to code
 */
async function applyFix(branchName, crash, fix, repoDir) {
  console.log('   Applying fixes to code...');
  
  // Always create FIXES.md with explanation
  const fixFile = path.join(repoDir, 'FIXES.md');
  const content = `
# Fix for ${crash.id}

## Issue
${crash.title}

## Description
${crash.description || 'No description'}

## Root Cause
${fix.explanation}

## Fixes Applied
${JSON.stringify(fix.fixes || [], null, 2)}

## Applied at
${new Date().toISOString()}

## Model Used
${currentConfig.model}
`;
  fs.appendFileSync(fixFile, content);

  // Apply code fixes if available
  if (fix.fixes && fix.fixes.length > 0) {
    for (const fileFix of fix.fixes) {
      try {
        const filePath = path.join(repoDir, fileFix.file);
        
        if (!fs.existsSync(filePath)) {
          console.log(`   File not found: ${fileFix.file}, creating...`);
          // Create parent dirs if needed
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(filePath, fileFix.fixed);
          console.log(`   Created: ${fileFix.file}`);
        } else if (fileFix.original && fileFix.fixed) {
          // Replace original code with fixed code
          const originalContent = fs.readFileSync(filePath, 'utf8');
          if (originalContent.includes(fileFix.original)) {
            const newContent = originalContent.replace(fileFix.original, fileFix.fixed);
            fs.writeFileSync(filePath, newContent);
            console.log(`   Fixed: ${fileFix.file} - ${fileFix.description}`);
          } else {
            console.log(`   Could not find original code in ${fileFix.file}, appending instead`);
            fs.appendFileSync(filePath, '\n\n' + fileFix.fixed);
          }
        }
      } catch (err) {
        console.log(`   Error applying fix to ${fileFix.file}: ${err.message}`);
      }
    }
  }

  // Commit and push
  execSync(`git add . && git commit -m "fix(${crash.id}): resolve ${crash.title}"`, {
    cwd: repoDir,
    stdio: 'inherit'
  });

  execSync(`git push -u origin ${branchName}`, {
    cwd: repoDir,
    stdio: 'inherit',
    env: { ...process.env, GIT_ASKPASS: '/bin/true' }
  });
  
  console.log('   Fixes applied and pushed!');
}

/**
 * Create pull request
 */
async function createPullRequest(branchName, crash) {
  const repoDir = '/tmp/openfix-repo';

  try {
    const prUrl = execSync(`gh pr create --title "Fix: ${crash.title}" --body "Auto-generated fix for crash ${crash.id}"`, {
      cwd: repoDir,
      encoding: 'utf8'
    }).trim();

    return prUrl;
  } catch (e) {
    return `https://github.com/${currentConfig.githubRepo}/pull/new/${branchName}`;
  }
}

/**
 * Update crash status - sends via WS + HTTP fallback
 */
async function updateCrashStatus(crashId, status, prUrl = null, error = null) {
  // Try WebSocket first
  wsSend('crash_update', { crashId, status, prUrl, error });

  // HTTP fallback
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

startAgent();
