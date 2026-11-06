import { defineConfig } from "vitest/config";

// The World tests run under node:test. See the test script.
export default defineConfig({ test: { exclude: ["test/idkit.test.ts", "test/agent-pass.test.ts", "test/agent-interview.test.ts", "test/gemini-model.test.ts", "test/groq-model.test.ts", "test/agent-models.test.ts", "node_modules/**"] } });
