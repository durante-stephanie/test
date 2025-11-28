const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");
const github = require("@actions/github");
const core = require("@actions/core");
const fs = require("fs");
const path = require("path");

// --- Configuration ---
const CONFIG = {
  modelName: "gemini-2.5-flash",
  files: {
    codingStandards: "Coding Guidelines/CODING_STANDARDS.md",
    copilotInstructions: "copilot-instructions.md",
  },
  diffLimit: 40000,
  maxLineLength: 80, // STRICT 80 char limit handled by JS
};

// --- Helper Functions ---

function initializeAI(apiKey) {
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: CONFIG.modelName,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          reviews: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                path: { type: SchemaType.STRING },
                line: { type: SchemaType.NUMBER },
                comment: { type: SchemaType.STRING },
                snippet: { type: SchemaType.STRING },
              },
              required: ["path", "line", "comment", "snippet"],
            },
          },
          conclusion: {
            type: SchemaType.STRING,
            enum: ["APPROVE", "REQUEST_CHANGES", "COMMENT"],
          },
        },
        required: ["reviews", "conclusion"],
      },
    },
  });
}

async function getPullRequestDiff(octokit, context) {
  const { data: prDiff } = await octokit.rest.pulls.get({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.payload.pull_request.number,
    mediaType: { format: "diff" },
  });
  return prDiff;
}

// ------------------------------------------------------------------
// CRITICAL FIX: Manually parse Diff to get EXACT Line Numbers
// ------------------------------------------------------------------
function parseDiff(diff) {
  const lines = diff.split('\n');
  let currentFile = '';
  let currentLine = 0;
  let parsedLines = [];

  for (const line of lines) {
    // 1. Detect File Changes
    if (line.startsWith('diff --git')) {
      const parts = line.split(' ');
      const bPath = parts.find(p => p.startsWith('b/'));
      if (bPath) currentFile = bPath.substring(2); // Remove 'b/'
      continue;
    }

    // 2. Detect Chunk Headers (e.g., @@ -10,5 +20,5 @@)
    // The second number set (+20,5) is the NEW file coordinates
    if (line.startsWith('@@')) {
      const match = line.match(/\+(\d+)/);
      if (match) currentLine = parseInt(match[1], 10);
      continue;
    }

    // 3. Process Code Lines
    if (currentFile) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        // This is a NEW line added by the user. We review this.
        const content = line.substring(1); // Remove the '+'
        parsedLines.push({
          file: currentFile,
          line: currentLine,
          content: content
        });
        currentLine++;
      } else if (line.startsWith(' ') && !line.startsWith('+++')) {
        // Unchanged line (context), just increment counter
        currentLine++;
      } else if (line.startsWith('-')) {
        // Deleted line, ignore for numbering of new file
      }
    }
  }
  return parsedLines;
}

function loadCodingGuidelines() {
  const workspace = process.env.GITHUB_WORKSPACE || ".";
  const standardsPath = path.join(workspace, ".github", CONFIG.files.codingStandards);
  const fallbackPath = path.join(workspace, ".github", CONFIG.files.copilotInstructions);

  if (fs.existsSync(standardsPath)) {
    return fs.readFileSync(standardsPath, "utf8");
  } else if (fs.existsSync(fallbackPath)) {
    return fs.readFileSync(fallbackPath, "utf8");
  }
  return "";
}

function createPrompt(rules, numberedDiffString) {
  return `
    You are a strict Senior Angular Code Reviewer.
    
    ### CODING GUIDELINES:
    ${rules}

    ### ACCURACY INSTRUCTIONS (CRITICAL):
    The code below is provided as: \`FILENAME:LINENUMBER:CODE_CONTENT\`.
    1. **Line Numbers:** You MUST use the exact line number provided in the prefix. Do NOT calculate it yourself.
    2. **Line Length:** IGNORE line length violations. The system checks this automatically.
    3. **Hallucination Prevention:**
       - **Nested Subscriptions:** Only flag \`.subscribe\` if you clearly see it *inside* another \`.subscribe\` block.
       - **Types:** \`data: any\` is "Forbidden any". \`data\` (no type) is "Missing type".

    ### OUTPUT RULES:
    - **No Tags:** Escape all Angular keywords (use \`@if\`, not @if) to avoid tagging users.
    - **Snippet:** Copy the code content exactly into the snippet field.

    ### TASK:
    Review the code lines below. Return a JSON object.
    - If violations found -> "conclusion": "REQUEST_CHANGES".
    - If code is good -> "conclusion": "APPROVE".

    CODE TO REVIEW:
    ${numberedDiffString.slice(0, CONFIG.diffLimit)} 
  `;
}

async function postReview(octokit, context, reviewData, automaticComments) {
  // Merge AI comments with Automatic (JS-based) comments
  let allComments = [...automaticComments];

  if (reviewData.reviews && reviewData.reviews.length > 0) {
    const aiComments = reviewData.reviews
      .filter((r) => r.line > 0)
      .map((r) => {
        // Sanitize comments to prevent tagging
        let safeComment = r.comment.replace(/(@(if|for|switch|let|case|default|else|empty))/g, '`$1`');
        
        return {
          path: r.path,
          line: r.line,
          body: `🤖 **AI Review:** ${safeComment}\n\n\`\`\`typescript\n${r.snippet}\n\`\`\``,
        };
      });
    allComments = allComments.concat(aiComments);
  }

  if (allComments.length > 0) {
    await octokit.rest.pulls.createReview({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.payload.pull_request.number,
      event: "REQUEST_CHANGES", 
      comments: allComments,
      body: "⚠️ **Violations found.** Please fix the issues below.",
    });
    return "REQUEST_CHANGES";
  }
  return "APPROVE";
}

async function run() {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const githubToken = process.env.GITHUB_TOKEN;

    if (!apiKey || !githubToken) {
      core.setFailed("Missing GEMINI_API_KEY or GITHUB_TOKEN secrets.");
      return;
    }

    const model = initializeAI(apiKey);
    const octokit = github.getOctokit(githubToken);
    const context = github.context;

    const prDiff = await getPullRequestDiff(octokit, context);
    if (!prDiff) {
      console.log("No changes found in this PR.");
      return;
    }

    // 1. Parse Diff and Run Automatic Checks (100% Accurate)
    const parsedLines = parseDiff(prDiff);
    const automaticComments = [];
    const numberedDiffLines = [];

    for (const lineObj of parsedLines) {
      // Check 1: Strict JS-based Line Length Check
      // We check content length. Note: Tabs/Spacing count as characters.
      if (lineObj.content.length > CONFIG.maxLineLength) {
        automaticComments.push({
          path: lineObj.file,
          line: lineObj.line,
          body: `📏 **Style Violation:** Line exceeds ${CONFIG.maxLineLength} characters (Current: ${lineObj.content.length}). Please break this line.`
        });
      }
      
      // Prepare content for AI (adding line numbers so AI doesn't guess)
      numberedDiffLines.push(`${lineObj.file}:${lineObj.line}:${lineObj.content}`);
    }

    // 2. Run AI Review for Logic/Syntax (Nested subs, types, etc.)
    const rules = loadCodingGuidelines();
    const prompt = createPrompt(rules, numberedDiffLines.join('\n'));

    console.log(`Sending content to ${CONFIG.modelName}...`);
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    let reviewData;
    try {
      reviewData = JSON.parse(responseText);
    } catch (e) {
      console.error("JSON Parse Error:", responseText);
      return; 
    }

    // 3. Post All Reviews (Automatic + AI)
    const finalStatus = await postReview(octokit, context, reviewData, automaticComments);

    if (finalStatus === "REQUEST_CHANGES") {
      core.setFailed(
        "❌ Blocking Merge: Violations of Coding Guidelines found. Please fix the issues commented by the AI."
      );
    } else {
      console.log("No issues found.");
    }
  } catch (error) {
    core.setFailed(`Review failed: ${error.message}`);
  }
}

run();