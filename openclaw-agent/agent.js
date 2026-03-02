/**
 * Openfix Agent
 * Handles crash analysis and auto-fix generation
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  backendUrl: process.env.BACKEND_URL || 'http://backend:3000',
  pollingInterval: 30000, // 30 seconds
};

// Simple in-memory cache for config
let githubToken = '';
let githubRepo = '';

/**
 * Main agent loop - listen for new crashes
 */
async function startAgent() {
  console.log('🤖 Openfix Agent starting...');
  console.log(`🔗 Backend: ${CONFIG.backendUrl}`);
  
  // Load config from backend
  await loadConfig();
  
  // Poll for new crashes
  setInterval(async () => {
    await checkForCrashes();
  }, CONFIG.pollingInterval);
  
  // Initial check
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
      githubToken = config[repoId].github_token;
      githubRepo = config[repoId].github_repo;
      
      console.log(`📦 Configured for: ${githubRepo}`);
    }
  } catch (error) {
    console.log('⚠️  No config yet, waiting for setup...');
  }
}

/**
 * Check for pending crashes
 */
async function checkForCrashes() {
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
  
  try {
    // 1. Analyze the crash
    console.log('📊 Analyzing crash...');
    const analysis = await analyzeCrash(crash);
    
    // 2. Clone repo if needed
    console.log('📥 Checking repository...');
    await ensureRepoCloned();
    
    // 3. Create fix branch
    const branchName = `fix/${crash.id}`;
    console.log(`🌿 Creating branch: ${branchName}`);
    await createFixBranch(branchName);
    
    // 4. Apply fix (placeholder - would integrate with OpenClaw AI)
    console.log('🔨 Applying fix...');
    await applyFix(branchName, crash, analysis);
    
    // 5. Create PR
    console.log('📝 Creating Pull Request...');
    const prUrl = await createPullRequest(branchName, crash);
    
    // 6. Update crash status
    await updateCrashStatus(crash.id, 'fixed', prUrl);
    
    console.log(`✅ Crash ${crash.id} fixed! PR: ${prUrl}`);
    
  } catch (error) {
    console.error(`❌ Failed to process crash:`, error.message);
    await updateCrashStatus(crash.id, 'failed', null, error.message);
  }
}

/**
 * Analyze crash data to determine fix
 */
async function analyzeCrash(crash) {
  // Simple analysis - in production, this would use AI/OpenClaw
  const title = crash.title.toLowerCase();
  
  let analysis = {
    rootCause: 'unknown',
    suggestedFix: '// TODO: Implement fix based on crash analysis',
    filesToModify: [],
    fixContent: ''
  };
  
  // Simple pattern matching for demo
  if (title.includes('null') || title.includes('undefined')) {
    analysis.rootCause = 'null-reference';
    analysis.suggestedFix = 'Add null check';
    analysis.fixContent = `\n// Fix: Added null check\nif (value === null || value === undefined) {\n  return;\n}\n`;
  } else if (title.includes('typeerror')) {
    analysis.rootCause = 'type-error';
    analysis.suggestedFix = 'Fix type mismatch';
    analysis.fixContent = `\n// Fix: Type assertion added\nconst typedValue = value as ExpectedType;\n`;
  }
  
  return analysis;
}

/**
 * Ensure repository is cloned
 */
async function ensureRepoCloned() {
  const repoDir = '/tmp/openfix-repo';
  
  if (!fs.existsSync(repoDir)) {
    console.log(`📦 Cloning ${githubRepo}...`);
    execSync(`git clone https://${githubToken}@github.com/${githubRepo}.git ${repoDir}`, {
      stdio: 'inherit'
    });
  }
  
  return repoDir;
}

/**
 * Create fix branch
 */
async function createFixBranch(branchName) {
  const repoDir = '/tmp/openfix-repo';
  
  // Checkout main and pull
  execSync('git checkout main && git pull', { cwd: repoDir, stdio: 'inherit' });
  
  // Create branch
  execSync(`git checkout -b ${branchName}`, { cwd: repoDir, stdio: 'inherit' });
  
  return branchName;
}

/**
 * Apply fix to code
 */
async function applyFix(branchName, crash, analysis) {
  const repoDir = '/tmp/openfix-repo';
  
  // For demo, create a simple fix file
  const fixFile = path.join(repoDir, 'FIXES.md');
  
  const fixContent = `
# Fix for ${crash.id}

## Issue
${crash.title}

## Description
${crash.description || 'No description'}

## Root Cause
${analysis.rootCause}

## Suggested Fix
${analysis.suggestedFix}

## Applied at
${new Date().toISOString()}
`;
  
  fs.appendFileSync(fixFile, fixContent);
  
  // Commit the fix
  execSync(`git add . && git commit -m "fix(${crash.id}): ${analysis.suggestedFix}"`, {
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
  
  // Use GitHub CLI if available, otherwise use API
  try {
    // Try gh CLI
    const prUrl = execSync(`gh pr create --title "Fix: ${crash.title}" --body "Auto-generated fix for crash ${crash.id}"`, {
      cwd: repoDir,
      encoding: 'utf8'
    }).trim();
    
    return prUrl;
  } catch (e) {
    // Fallback: return branch URL
    return `https://github.com/${githubRepo}/pull/new/${branchName}`;
  }
}

/**
 * Update crash status in backend
 */
async function updateCrashStatus(crashId, status, prUrl = null, error = null) {
  try {
    await fetch(`${CONFIG.backendUrl}/api/crashes/${crashId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, prUrl, error })
    });
  } catch (error) {
    console.error('Failed to update crash status:', error.message);
  }
}

// Start the agent
startAgent();
