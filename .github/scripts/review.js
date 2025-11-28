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
      model: "gemini-2.5-flash", // STRICTLY using 2.5 Flash as requested
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

    // 4. Load Coding Guidelines (PUP AppDev Standards)
    // We try to read your specific markdown file first
    let rules = "";
    try {
      const rulesPath = path.join(process.env.GITHUB_WORKSPACE || '.', '.github', 'Coding Guidelines', 'CODING_STANDARDS.md');
      if (fs.existsSync(rulesPath)) {
        rules = fs.readFileSync(rulesPath, "utf8");
        console.log("✅ Loaded guidelines from CODING_STANDARDS.md");
      } else {
        // Fallback to copilot instructions if the specific file isn't found
        const fallbackPath = path.join(process.env.GITHUB_WORKSPACE || '.', '.github', 'copilot-instructions.md');
        if (fs.existsSync(fallbackPath)) {
          rules = fs.readFileSync(fallbackPath, "utf8");
          console.log("✅ Loaded guidelines from copilot-instructions.md");
        }
      }
    } catch (error) {
      console.log("⚠️ Could not read rule files. Using default strict Angular rules.");
    }

    // 5. Construct the Prompt for Gemini 2.5
    const prompt = `
      You are a strict Senior Angular Code Reviewer for PUP.
      Your job is to review the code changes below and enforce the following guidelines.

      ### CODING GUIDELINES (STRICTLY ENFORCE):
      ${rules}

      ### ADDITIONAL CHECKS:
      - **FORBIDDEN:** usage of 'any', 'ngStyle', '*ngIf', '*ngFor'.
      - **REQUIRED:** use signals, @if, @for, typed interfaces/models.
      - **REQUIRED:** strict types for function parameters.

      ### TASK:
      Review the GIT DIFF below.
      If you find violations, output a JSON object with the file path, line number, and a helpful comment.
      If the code follows the guidelines, return "conclusion": "APPROVE".

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
      console.error("Error parsing JSON response:", responseText);
      // Fallback if model hallucinates non-JSON
      return;
    }

    // 7. Post Comments to GitHub
    if (reviewData.reviews && reviewData.reviews.length > 0) {
      const comments = reviewData.reviews.map(r => ({
        path: r.path,
        line: r.line,
        body: `🤖 **PUP AI Review:** ${r.comment}`
      }));

      // Post reviews in a batch
      await octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        event: reviewData.conclusion === 'APPROVE' ? 'COMMENT' : 'REQUEST_CHANGES',
        comments: comments,
        body: reviewData.conclusion === 'APPROVE' 
          ? "✅ **Gemini 2.5:** Code adheres to PUP Guidelines." 
          : "⚠️ **Gemini 2.5:** Violations of PUP AppDev Guidelines found."
      });
    } else {
      console.log("No issues found. Code approved.");
    }

  } catch (error) {
    core.setFailed(`Workflow failed: ${error.message}`);
  }
}

run();