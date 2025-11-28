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

/**
 * Initializes the Google Generative AI model.
 */
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
              },
              required: ["path", "line", "comment"],
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

/**
 * Fetches the pull request diff from GitHub.
 */
async function getPullRequestDiff(octokit, context) {
  const { data: prDiff } = await octokit.rest.pulls.get({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.payload.pull_request.number,
    mediaType: { format: "diff" },
  });
  return prDiff;
}

/**
 * Reads coding guidelines from the repository.
 */
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

/**
 * Constructs the prompt for the AI model.
 */
function createPrompt(rules, diff) {
  return `
    You are a strict Senior Angular Code Reviewer.
    
    ### CODING GUIDELINES:
    ${rules}

    ### CRITICAL INSTRUCTIONS FOR LINE NUMBERS:
    - You are reviewing a GIT DIFF. 
    - The "line" property MUST be the line number in the *new* file (the right side of the diff).
    - If you are unsure of the exact line, comment on the first line of the new code block.
    - **Do not** hallucinate line numbers that don't exist in the diff.

    ### ADDITIONAL CHECKS:
    - **FORBIDDEN:** 'any', 'ngStyle', '*ngIf', '*ngFor'.
    - **REQUIRED:** signals, @if, @for, typed interfaces.

    ### TASK:
    Review the diff below. Return a JSON object.
    - If violations found -> "conclusion": "REQUEST_CHANGES".
    - If code is good -> "conclusion": "APPROVE".

    GIT DIFF:
    ${diff.slice(0, CONFIG.diffLimit)} 
  `;
}

/**
 * Posts review comments to the GitHub Pull Request.
 */
async function postReview(octokit, context, reviewData) {
  if (!reviewData.reviews || reviewData.reviews.length === 0) return;

  const validComments = reviewData.reviews
    .filter((r) => r.line > 0)
    .map((r) => ({
      path: r.path,
      line: r.line,
      body: `🤖 **AI Review:** ${r.comment}`,
    }));

  if (validComments.length > 0) {
    await octokit.rest.pulls.createReview({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.payload.pull_request.number,
      event: reviewData.conclusion === "APPROVE" ? "COMMENT" : "REQUEST_CHANGES",
      comments: validComments,
      body:
        reviewData.conclusion === "APPROVE"
          ? "✅ Code looks good."
          : "⚠️ **Violations found.** Please fix the issues below.",
    });
  }
}

// --- Main Execution ---

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
    if (!rules) console.log("Using default strict Angular rules.");

    const prompt = createPrompt(rules, prDiff);

    console.log(`Sending diff to ${CONFIG.modelName}...`);
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    let reviewData;
    try {
      reviewData = JSON.parse(responseText);
    } catch (e) {
      console.error("JSON Parse Error:", responseText);
      return;
    }

    await postReview(octokit, context, reviewData);

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