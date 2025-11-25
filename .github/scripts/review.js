const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");
const github = require("@actions/github");
const core = require("@actions/core");
const fs = require("fs");

async function run() {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const githubToken = process.env.GITHUB_TOKEN;

    if (!apiKey || !githubToken) {
      core.setFailed("Missing GEMINI_API_KEY or GITHUB_TOKEN.");
      return;
    }

    // 1. Initialize Gemini with JSON Schema enforcement
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

    // 2. Initialize GitHub
    const octokit = github.getOctokit(githubToken);
    const context = github.context;
    const prNumber = context.payload.pull_request.number;
    const owner = context.repo.owner;
    const repo = context.repo.repo;

    // 3. Get the Diff (Limit size to prevent token overflow)
    const { data: prDiff } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: { format: "diff" },
    });

    if (!prDiff) {
      console.log("No diff found.");
      return;
    }

    // 4. Read Coding Standards
    let codingStandards = "Follow general Angular best practices.";
    try {
      if (fs.existsSync("Coding Guidelines/CODING_STANDARDS.md")) {
        codingStandards = fs.readFileSync("Coding Guidelines/CODING_STANDARDS.md", "utf8");
      }
    } catch (e) {
      console.log("Could not read CODING_STANDARDS.md");
    }

    // 5. Build Prompt for "Inline" Review
    const prompt = `
      You are a strict Code Reviewer for an Angular project.
      
      YOUR RULES:
      ${codingStandards}

      TASK:
      Review the provided Git Diff. Identify violations of the rules.
      For every violation, output a review comment.
      
      IMPORTANT FOR MAPPING:
      - "path": Must match the file path in the diff exactly.
      - "line": Must be the line number in the NEW file (the 'right' side of the diff) where the error occurs.
      - "comment": Explain the error and provide the fix (e.g., "Use @if instead of *ngIf").
      - "conclusion": If there are violations, return "REQUEST_CHANGES". If perfect, "APPROVE".

      GIT DIFF TO REVIEW:
      ${prDiff.substring(0, 30000)}
    `;

    // 6. Generate JSON Response
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    
    let reviewData;
    try {
      reviewData = JSON.parse(text);
    } catch (e) {
      console.error("Failed to parse JSON from AI:", text);
      core.setFailed("AI returned invalid JSON.");
      return;
    }

    // 7. Post the Review to GitHub
    // We only post comments if they exist.
    const comments = reviewData.reviews.map(review => ({
      path: review.path,
      line: review.line,
      body: `🤖 **AI Review:** ${review.comment}`
    }));

    if (comments.length > 0 || reviewData.conclusion !== 'COMMENT') {
      await octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        event: reviewData.conclusion, // APPROVE or REQUEST_CHANGES
        comments: comments,
        body: reviewData.conclusion === 'REQUEST_CHANGES' 
          ? "⚠️ **Code Guidelines Violation:** Please fix the issues below." 
          : "✅ Code looks good!",
      });
    }

    // 8. BLOCK THE MERGE if changes are requested
    if (reviewData.conclusion === "REQUEST_CHANGES") {
      core.setFailed("The AI Code Reviewer found violations. Please fix them before merging.");
    }

  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

run();