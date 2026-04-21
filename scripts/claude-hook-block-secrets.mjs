#!/usr/bin/env node
// PreToolUse hook — blocks edits that would expose secrets.
// Input: JSON on stdin with tool_name, tool_input { file_path, content, new_string, etc. }
// Exit 0 = allow, exit 2 = block with stderr message shown to the user.

import { readFileSync } from 'node:fs';

const SECRET_PATTERNS = [
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Anthropic API key', re: /sk-ant-[a-zA-Z0-9_-]{40,}/ },
  { name: 'OpenAI API key', re: /sk-[a-zA-Z0-9]{48,}/ },
  { name: 'GitHub PAT', re: /ghp_[a-zA-Z0-9]{30,}/ },
  { name: 'GitHub fine-grained token', re: /github_pat_[a-zA-Z0-9_]{80,}/ },
  { name: 'Slack token', re: /xox[baprs]-[a-zA-Z0-9-]{10,}/ },
  { name: 'Stripe live key', re: /sk_live_[a-zA-Z0-9]{24,}/ },
  { name: 'Supabase service role', re: /eyJ[a-zA-Z0-9_-]{100,}\.eyJ[a-zA-Z0-9_-]{100,}\.[a-zA-Z0-9_-]{20,}/ },
  { name: 'Alpaca API key', re: /PK[A-Z0-9]{18}/ },
  { name: 'Generic long base64 secret', re: /(?:password|secret|token|api[_-]?key)\s*[:=]\s*["'][a-zA-Z0-9/_+=-]{32,}["']/i },
];

const BLOCKED_PATHS = [
  /\.env($|\.)/,
  /\.git\//,
  /\.ssh\//,
  /id_rsa/,
  /credentials\.json/,
];

function read() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

const input = read();
const toolName = input.tool_name || '';
const toolInput = input.tool_input || {};

if (!['Edit', 'Write', 'MultiEdit'].includes(toolName)) {
  process.exit(0);
}

const filePath = toolInput.file_path || '';

for (const pattern of BLOCKED_PATHS) {
  if (pattern.test(filePath)) {
    console.error(`[block-secrets] refusing to write ${filePath} — secret-critical path. If intentional, edit manually in your shell.`);
    process.exit(2);
  }
}

const contentToCheck = [
  toolInput.content,
  toolInput.new_string,
  ...(Array.isArray(toolInput.edits) ? toolInput.edits.map(e => e.new_string) : []),
]
  .filter(Boolean)
  .join('\n');

if (!contentToCheck) {
  process.exit(0);
}

for (const { name, re } of SECRET_PATTERNS) {
  if (re.test(contentToCheck)) {
    console.error(`[block-secrets] refusing to write ${filePath} — content appears to contain a ${name}. Move secrets to .env and reference via process.env.`);
    process.exit(2);
  }
}

process.exit(0);
