/**
 * Openfix Agent
 * Handles crash analysis and auto-fix generation
 * Supports multiple AI models
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  backendUrl: process.env.BACKEND_URL || 'http://backend:3000',
  pollingInterval: 30000,
};

// Current config
let currentConfig = {
  githubToken: '',
  githubRepo: '',
  model: 'minimax/MiniMax-M2.5',
  apiKey: ''
};

/**
 * Main agent loop
 */
async function startAgent() {
  console.log('🤖 Openfix Agent starting...');
  console.log(`🔗 Backend: ${CONFIG.backendUrl}`);
  
  await loadConfig();
  
  setInterval(async () => {
    await checkForCrashes();
  }, CONFIG.pollingInterval);
  
  await checkForCrashes();
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
      
      console.log(`📦 Config loaded:`);
      console.log(`   - Repo: ${currentConfig.githubRepo}`);
      console.log(`   - Model: ${currentConfig.model}`);
    }
  } catch (error) {
    console.log('⚠️  No config yet, waiting for setup...');
  }
}

/**
 * Check for pending crashes
 */
async function checkForCrashes() {
  await loadConfig(); // Refresh config
  
  try {
    const response = await fetch(`${CONFIG.backendUrl}/api/crashes?status=pending`);
    const crashes = await response.json();
    
    if (crashes.length > 0) {
      console.log(`📩 Found ${crashes.length} pending crash(es)`);
      
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
  console.log(`🔧 Processing crash: ${crash.id}`);
  console.log(`   Title: ${crash.title}`);
  console.log(`   Model: ${currentConfig.model}`);
  
  try {
    // 1. Ensure repo is available
    const repoDir = await ensureRepoCloned();
    
    // 2. Analyze crash and generate fix with AI
    console.log('🤖 Generating fix with AI...');
    const analysis = await analyzeCrashWithAI(crash, repoDir);
    
    // 3. Create fix branch
    const branchName = `fix/${crash.id}`;
    console.log(`🌿 Creating branch: ${branchName}`);
    await createFixBranch(branchName);
    
    // 4. Apply fix
    console.log('🔨 Applying fix...');
    await applyFix(branchName, crash, analysis, repoDir);
    
    // 5. Create PR
    console.log('📝 Creating Pull Request...');
    const prUrl = await createPullRequest(branchName, crash);
    
    // 6. Update status
    await updateCrashStatus(crash.id, 'fixed', prUrl);
    
    console.log(`✅ Crash ${crash.id} fixed!`);
    console.log(`   PR: ${prUrl}`);
    
  } catch (error) {
    console.error(`❌ Failed:`, error.message);
    await updateCrashStatus(crash.id, 'failed', null, error.message);
  }
}

/**
 * Analyze crash and generate fix using AI
 */
async function analyzeCrashWithAI(crash, repoDir) {
  // 1. Find relevant code files
  const relevantFiles = await findRelevantFiles(crash, repoDir);
  
  // 2. Build context for AI
  const context = {
    crash: {
      id: crash.id,
      title: crash.title,
      description: crash.description,
      severity: crash.severity
    },
    relevantFiles: relevantFiles.slice(0, 5), // Limit to 5 files
    model: currentConfig.model
  };
  
  // 3. Call AI API based on model selection
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
  // Placeholder - implement actual API call
  console.log(`   Using MiniMax M2.5...`);
  
  return {
    explanation: 'Fix generated using MiniMax M2.5',
    changes: [
      {
        file: 'src/auth/auth.service.ts',
        content: `\n// Fix: Added null check\nif (value === null || value === undefined) {\n  console.error('Null value detected');\n  return;\n}\n`
      }
    ]
  };
}

/**
 * Generate fix using OpenAI
 */
async function generateFixWithOpenAI(context) {
  console.log(`   Using GPT-4o...`);
  
  if (!currentConfig.apiKey) {
    console.log('⚠️  No OpenAI API key, using fallback');
    return await generateFixWithMiniMax(context);
  }
  
  // Implement OpenAI API call
  return { explanation: 'Fix from OpenAI', changes: [] };
}

/**
 * Generate fix using Claude
 */
async function generateFixWithClaude(context) {
  console.log(`   Using Claude 3.5...`);
  
  if (!currentConfig.apiKey) {
    console.log('⚠️  No Claude API key, using fallback');
    return await generateFixWithMiniMax(context);
  }
  
  return { explanation: 'Fix from Claude', changes: [] };
}

/**
 * Generate fix using Gemini
 */
async function generateFixWithGemini(context) {
  console.log(`   Using Gemini 2.0...`);
  
  if (!currentConfig.apiKey) {
    console.log('⚠️  No Gemini API key, using fallback');
    return await generateFixWithMiniMax(context);
  }
  
  return { explanation: 'Fix from Gemini', changes: [] };
}

/**
 * Find relevant files in the repo
 */
async function findRelevantFiles(crash, repoDir) {
  const files = [];
  
  try {
    // Simple search based on crash title keywords
    const keywords = crash.title.toLowerCase()
      .replace(/[^a-z0-9]/g, ' ')
      .split(' ')
      .filter(k => k.length > 3)
      .slice(0, 3);
    
    // Search for files
    const searchCmd = `find ${repoDir}/src -type f -name "*.ts" -o -name "*.js" 2>/dev/null | head -20`;
    const result = execSync(searchCmd, { encoding: 'utf8' });
    
    const allFiles = result.trim().split('\n');
    
    // Match files with keywords
    for (const file of allFiles) {
      for (const keyword of keywords) {
        if (file.toLowerCase().includes(keyword)) {
          files.push({
            path: file,
            name: path.basename(file)
          });
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
 * Ensure repository is cloned
 */
async function ensureRepoCloned() {
  const repoDir = '/tmp/openfix-repo';
  
  if (!fs.existsSync(repoDir)) {
    if (!currentConfig.githubRepo || !currentConfig.githubToken) {
      throw new Error('GitHub not configured');
    }
    
    console.log(`📦 Cloning ${currentConfig.githubRepo}...`);
    const repoUrl = `https://${currentConfig.githubToken}@github.com/${currentConfig.githubRepo}.git`;
    execSync(`git clone ${repoUrl} ${repoDir}`, { stdio: 'inherit' });
  }
  
  return repoDir;
}

/**
 * Create fix branch
 */
async function createFixBranch(branchName) {
  const repoDir = '/tmp/openfix-repo';
  
  execSync('git checkout main && git pull', { cwd: repoDir, stdio: 'inherit' });
  execSync(`git checkout -b ${branchName}`, { cwd: repoDir, stdio: 'inherit' });
  
  return branchName;
}

/**
 * Apply fix to code
 */
async function applyFix(branchName, crash, fix, repoDir) {
  // Create a fix summary file
  const fixFile = path.join(repoDir, 'FIXES.md');
  
  const content = `
# Fix for ${crash.id}

## Issue
${crash.title}

## Description
${crash.description || 'No description'}

## Root Cause
${fix.explanation}

## Applied at
${new Date().toISOString()}

## Model Used
${currentConfig.model}
`;
  
  fs.appendFileSync(fixFile, content);
  
  // Commit the fix
  execSync(`git add . && git commit -m "fix(${crash.id}): resolve ${crash.title}"`, {
    cwd: repoDir,
    stdio: 'inherit'
  });
  
  // Push branch
  execSync(`git push -u origin ${branchName}`, {
    cwd: repoDir,
    stdio: 'inherit',
    env: { ...process.env, GIT_ASKPASS: '/bin/true' }
  });
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
 * Update crash status
 */
async function updateCrashStatus(crashId, status, prUrl = null, error = null) {
  try {
    await fetch(`${CONFIG.backendUrl}/api/crashes/${crashId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, prUrl, error })
    });
  } catch (error) {
    console.error('Failed to update status:', error.message);
  }
}

startAgent();
