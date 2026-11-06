/**
 * FR8 / NFR3: the counting rule, with no dependency on the backend. The public
 * recount CLI and the live tally both run this exact function, so a mismatch
 * between them can only come from different input data.
 */

export type Sentiment = "support" | "oppose" | "neutral";
export const SENTIMENTS: readonly Sentiment[] = ["support", "oppose", "neutral"];

export type TallyDocket = { deadline: bigint; topics: string[] };

export type TallyComment = {
  key: string;
  topic: string;
  ownerHash: string;
  authorType: string;
  sentiment: string;
  submittedAt: bigint;
};

export type TopicTally = {
  topic: string;
  counted: number;
  stored: number;
  support: number;
  oppose: number;
  neutral: number;
  human: number;
  agent: number;
};

export type Tally = {
  counted: number;
  stored: number;
  ignored: { duplicate: number; late: number; unknownTopic: number };
  topics: TopicTally[];
};

/**
 * Counts a member's earliest comment per topic. Later ones stay on record but
 * do not count (FR4), and neither do comments after the deadline. Ties break on
 * entity key so any two recounts agree.
 */
export function tally(docket: TallyDocket, comments: readonly TallyComment[]): Tally {
  const topics = new Map<string, TopicTally>(
    docket.topics.map((topic) => [
      topic,
      { topic, counted: 0, stored: 0, support: 0, oppose: 0, neutral: 0, human: 0, agent: 0 },
    ]),
  );
  const ignored = { duplicate: 0, late: 0, unknownTopic: 0 };
  const seen = new Set<string>();

  const ordered = [...comments].sort((a, b) =>
    a.submittedAt === b.submittedAt
      ? a.key.localeCompare(b.key)
      : a.submittedAt < b.submittedAt
        ? -1
        : 1,
  );

  for (const comment of ordered) {
    const row = topics.get(comment.topic);
    if (!row) {
      ignored.unknownTopic++;
      continue;
    }
    row.stored++;
    if (comment.submittedAt > docket.deadline) {
      ignored.late++;
      continue;
    }
    const voter = `${comment.topic}\u0000${comment.ownerHash}`;
    if (seen.has(voter)) {
      ignored.duplicate++;
      continue;
    }
    seen.add(voter);
    row.counted++;
    if (comment.sentiment === "support" || comment.sentiment === "oppose" || comment.sentiment === "neutral") {
      row[comment.sentiment]++;
    }
    if (comment.authorType === "agent") row.agent++;
    else row.human++;
  }

  const rows = [...topics.values()];
  return {
    counted: rows.reduce((sum, row) => sum + row.counted, 0),
    stored: comments.length,
    ignored,
    topics: rows,
  };
}
