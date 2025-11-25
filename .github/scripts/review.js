const { GoogleGenerativeAI } = require("@google/generative-ai");
const github = require("@actions/github");
const core = require("@actions/core");
const fs = require("fs");

async function run() {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const githubToken = process.env.GITHUB_TOKEN;

    if (!apiKey) {
      core.setFailed("GEMINI_API_KEY secret is missing!");
      return;
    }

    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(apiKey);
    // FIX: Using the specific pinned version 'gemini-1.5-flash-001' for stability
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Initialize GitHub Client
    const octokit = github.getOctokit(githubToken);
    const context = github.context;
    const prNumber = context.payload.pull_request.number;
    const owner = context.repo.owner;
    const repo = context.repo.repo;

    // 1. Get the Diff of the Pull Request
    const { data: prDiff } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: { format: "diff" },
    });

    // 2. Read your Coding Guidelines
    let codingStandards = "Follow general Angular best practices.";
    try {
      if (fs.existsSync("Coding Guidelines/CODING_STANDARDS.md")) {
        codingStandards = fs.readFileSync("Coding Guidelines/CODING_STANDARDS.md", "utf8");
      }
    } catch (e) {
      console.log("Could not read CODING_STANDARDS.md, using default.");
    }

    // 3. Construct the Prompt for Gemini
    const prompt = `
      You are a strict Code Reviewer for a Student AppDev project.
      
      YOUR INSTRUCTIONS:
      ${codingStandards}

      TASK:
      Review the following GitHub Pull Request diff. 
      - If the code follows the guidelines, praise it briefly.
      - If it violates specific rules (like using *ngIf, any type, or ngStyle), point it out specifically and show the correct code.
      - Be concise and helpful.
      
      THE CODE DIFF:
      ${prDiff.substring(0, 30000)} // Limit characters to avoid limits
    `;

    // 4. Generate Review
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const reviewComment = response.text();

    // 5. Post Comment to PR
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: `## 🤖 Gemini AI Code Review\n\n${reviewComment}`,
    });

  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
  }
}

run();