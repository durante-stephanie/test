const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");
const github = require("@actions/github");
const core = require("@actions/core");
const fs = require("fs");
const path = require("path");

async function run() {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const githubToken = process.env.GITHUB_TOKEN;

    if (!apiKey || !githubToken) {
      core.setFailed("Missing GEMINI_API_KEY or GITHUB_TOKEN secrets.");
      return;
    }

    // 1. Initialize Gemini 2.5 Flash
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash", 
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

    // 2. Initialize GitHub Context
    const octokit = github.getOctokit(githubToken);
    const context = github.context;
    const prNumber = context.payload.pull_request.number;
    const owner = context.repo.owner;
    const repo = context.repo.repo;

    // 3. Fetch the Pull Request Diff
    // We request the diff to calculate correct line numbers
    const { data: prDiff } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: { format: "diff" },
    });

    if (!prDiff) {
      console.log("No changes found in this PR.");
      return;
    }

    // 4. Load Coding Guidelines
    let rules = "";
    try {
      const rulesPath = path.join(process.env.GITHUB_WORKSPACE || '.', '.github', 'Coding Guidelines', 'CODING_STANDARDS.md');
      if (fs.existsSync(rulesPath)) {
        rules = fs.readFileSync(rulesPath, "utf8");
      } else {
        const fallbackPath = path.join(process.env.GITHUB_WORKSPACE || '.', '.github', 'copilot-instructions.md');
        if (fs.existsSync(fallbackPath)) {
          rules = fs.readFileSync(fallbackPath, "utf8");
        }
      }
    } catch (error) {
      console.log("Using default strict Angular rules.");
    }

    // 5. Construct Prompt
    // We explicitly tell the AI how to handle line numbers to improve accuracy
    const prompt = `
      You are a strict Senior Angular Code Reviewer for PUP.
      
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
      - If violations found -> "conclusion": "COMMENT" (Do not block merge, just warn).
      - If code is good -> "conclusion": "APPROVE".

      GIT DIFF:
      ${prDiff.slice(0, 40000)} 
    `;

    // 6. Generate Review
    console.log("Sending diff to Gemini 2.5 Flash...");
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    let reviewData;
    try {
      reviewData = JSON.parse(responseText);
    } catch (e) {
      console.error("JSON Parse Error:", responseText);
      return;
    }

    // 7. Post Comments
    if (reviewData.reviews && reviewData.reviews.length > 0) {
      // Filter out comments with invalid line numbers (simple check)
      const validComments = reviewData.reviews.filter(r => r.line > 0);

      const comments = validComments.map(r => ({
        path: r.path,
        line: r.line,
        body: `🤖 **AI Review:** ${r.comment}`
      }));

      if (comments.length > 0) {
        await octokit.rest.pulls.createReview({
          owner,
          repo,
          pull_number: prNumber,
          event: 'COMMENT', // Changed from REQUEST_CHANGES to COMMENT to avoid blocking merge
          comments: comments,
          body: "⚠️ **Gemini found potential issues.** Please review the comments."
        });
      }
    } else {
      console.log("No issues found.");
    }

  } catch (error) {
    // We just log the error instead of failing the workflow, so it doesn't block the PR
    console.error(`Review failed but ignored: ${error.message}`);
  }
}

run();