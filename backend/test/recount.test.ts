import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tally, type TallyComment } from "../src/recount.ts";

const docket = { deadline: 1000n, topics: ["emissions", "cost"] };
const comment = (key: string, overrides: Partial<TallyComment> = {}): TallyComment => ({
  key,
  topic: "emissions",
  ownerHash: `owner-${key}`,
  authorType: "human",
  sentiment: "support",
  submittedAt: 100n,
  ...overrides,
});

describe("tally", () => {
  it("counts sentiment and author type per topic", () => {
    const result = tally(docket, [
      comment("a"),
      comment("b", { sentiment: "oppose", authorType: "agent" }),
      comment("c", { topic: "cost", sentiment: "neutral" }),
    ]);
    expect(result.counted).toBe(3);
    expect(result.topics[0]).toMatchObject({ topic: "emissions", support: 1, oppose: 1, human: 1, agent: 1 });
    expect(result.topics[1]).toMatchObject({ topic: "cost", neutral: 1 });
  });

  it("counts a member's earliest comment per topic and stores the rest", () => {
    const result = tally(docket, [
      comment("later", { ownerHash: "same", sentiment: "oppose", submittedAt: 200n }),
      comment("first", { ownerHash: "same", sentiment: "support", submittedAt: 100n }),
    ]);
    expect(result).toMatchObject({ counted: 1, stored: 2, ignored: { duplicate: 1 } });
    expect(result.topics[0]).toMatchObject({ support: 1, oppose: 0 });
  });

  it("lets one member count once on each topic", () => {
    const result = tally(docket, [comment("a", { ownerHash: "same" }), comment("b", { ownerHash: "same", topic: "cost" })]);
    expect(result.counted).toBe(2);
  });

  it("ignores comments after the deadline and unknown topics", () => {
    const result = tally(docket, [comment("late", { submittedAt: 1001n }), comment("odd", { topic: "other" })]);
    expect(result).toMatchObject({ counted: 0, ignored: { late: 1, unknownTopic: 1 } });
  });

  it("gives the same answer in any input order, including exact ties", () => {
    const comments = [
      comment("b", { ownerHash: "same", sentiment: "oppose" }),
      comment("a", { ownerHash: "same", sentiment: "support" }),
      comment("c"),
    ];
    expect(tally(docket, comments)).toEqual(tally(docket, [...comments].reverse()));
    expect(tally(docket, comments).topics[0]).toMatchObject({ support: 2, oppose: 0 });
  });
});

describe("the browser recount", () => {
  it("runs the exact same rule as the backend", () => {
    const read = (path: string) => readFileSync(path, "utf8").split("\r\n").join("\n");
    expect(read("../frontend/lib/recount.ts")).toBe(read("src/recount.ts"));
  });
});
