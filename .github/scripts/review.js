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

function createPrompt(rules, diff) {
  return `
    You are a strict Senior Angular Code Reviewer.
    
    ### CODING GUIDELINES (SOURCE OF TRUTH):
    ${rules}

    ### HALLUCINATION PREVENTION (READ CAREFULLY):
    1. **Line Length:** STRICTLY enforce the 80 character limit per line as per the guidelines. Flag any line that exceeds this limit.
    2. **Nested Subscriptions:** A "Nested Subscription" is strictly defined as calling \`.subscribe()\` *inside* the callback function of another \`.subscribe()\`. 
       - ❌ VIOLATION: \`obs1.subscribe(val => { obs2.subscribe(...) })\`
       - ✅ OK: \`function() { obs1.subscribe(...) }\` (This is NOT nested).
    3. **Types:** - If you see \`param: any\`, flag it as "Forbidden usage of 'any'". 
       - If you see \`param\`, flag it as "Missing type definition".
       - Do NOT confuse the two.
    4. **HttpClient:** Ensure you strictly check if \`HttpClient\` is injected in a Component constructor. If it is a Service, it is allowed.

    ### CRITICAL INSTRUCTIONS:
    - **NO NAMES:** Do not address the user by name or username. Keep it professional.
    - **NO MENTIONS:** When referring to Angular control flow (like @if, @for), **ALWAYS** wrap them in backticks (e.g., \`@if\`) to avoid tagging GitHub users.
    - **SNIPPET:** You MUST populate the "snippet" field with the exact code you are flagging.
    - **LINE NUMBERS:** Ensure the line number matches the *new* file in the diff.

    ### TEST INSTRUCTIONS (Verify these specific cases):
    - Check for correct usage of Angular Control Flow syntax:
      - \`@if\` blocks
      - \`@for\` blocks
      - \`@switch\` blocks
    - Ensure legacy directives like \`*ngIf\` or \`*ngFor\` are FLAGGED as violations if the guidelines require the new syntax.

    ### TASK:
    Review the diff below. Return a JSON object.
    - If violations found -> "conclusion": "REQUEST_CHANGES".
    - If code is good -> "conclusion": "APPROVE".

    GIT DIFF:
    ${diff.slice(0, CONFIG.diffLimit)} 
  `;
}

async function postReview(octokit, context, reviewData) {
  if (!reviewData.reviews || reviewData.reviews.length === 0) return;

  const validComments = reviewData.reviews
    .filter((r) => r.line > 0)
    .map((r) => {
      // SANITIZATION: Escape @if, @for, @switch, @let to prevent accidental user tagging
      // We replace "@keyword" with "`@keyword`" if it's not already inside backticks.
      // A simple regex approach to ensure common Angular keywords are safe.
      let safeComment = r.comment.replace(/(@(if|for|switch|let|case|default|else))/g, '`$1`');
      // Clean up double backticks if they happened (e.g. ``@if``)
      safeComment = safeComment.replace(/``/g, '`');

      return {
        path: r.path,
        line: r.line,
        body: `🤖 **AI Review:** ${safeComment}\n\n\`\`\`typescript\n${r.snippet}\n\`\`\``,
      };
    });

  if (validComments.length > 0) {
    await octokit.rest.pulls.createReview({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.payload.pull_request.number,
      event: reviewData.conclusion,
      comments: validComments,
      body:
        reviewData.conclusion === "APPROVE"
          ? "✅ Code looks good."
          : "⚠️ **Violations found.** Please fix the issues below.",
    });
  }
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

    const rules = loadCodingGuidelines();
    const prompt = createPrompt(rules, prDiff);

    console.log(`Sending diff to ${CONFIG.modelName}...`);
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    let reviewData;
    try {
      reviewData = JSON.parse(responseText);
    } catch (e) {
      console.error("JSON Parse Error:", responseText);
      return; // Do not fail if AI glitches, just skip
    }

    await postReview(octokit, context, reviewData);

    // Block the merge if violations are found
    if (reviewData.conclusion === "REQUEST_CHANGES") {
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