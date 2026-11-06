/**
 * A stand-in for a member's own agent. It reads a docket and parks a draft; it has no
 * way to post. Writing the draft text is the agent's job (README Module 3 scope), so
 * here it's passed in with --text.
 *
 *   npm run agent -w backend -- draft --token cda_... --docket 0x<docket key> --topic enforcement --sentiment support --text "..."
 *   npm run agent -w backend -- edit  --token cda_... --draft draft_... --text "..." [--sentiment oppose]
 *   npm run agent -w backend -- show  --token cda_... --draft draft_...
 */
import { parseArgs } from "node:util";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: "string", default: process.env.COMMENTDESK_API ?? "http://localhost:4000" },
    token: { type: "string", default: process.env.AGENT_TOKEN },
    docket: { type: "string" },
    topic: { type: "string" },
    draft: { type: "string" },
    text: { type: "string" },
    sentiment: { type: "string" },
  },
});

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${values.base}${path}`, {
    method,
    headers: { authorization: `Bearer ${values.token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${data.reason}: ${data.error}`);
  return data;
}

const need = (v: string | undefined, name: string) => {
  if (!v) throw new Error(`--${name} is required`);
  return v;
};

need(values.token, "token");
switch (positionals[0]) {
  case "draft": {
    const docket = await call("GET", `/api/agent/dockets/${encodeURIComponent(need(values.docket, "docket"))}`);
    console.log(`Read docket "${docket.title}" (topics: ${docket.topics.join(", ")})`);
    if (docket.question) console.log(`Question: ${docket.question}`);
    const draft = await call("POST", "/api/agent/drafts", {
      docketKey: docket.key,
      topic: need(values.topic, "topic"),
      text: need(values.text, "text"),
      sentiment: values.sentiment,
    });
    console.log(`Parked draft ${draft.draftKey} (#${draft.draftHash.slice(0, 12)}). It posts only if the human approves it via Agent Pass.`);
    break;
  }
  case "edit": {
    const draft = await call("PATCH", `/api/agent/drafts/${need(values.draft, "draft")}`, {
      text: need(values.text, "text"),
      sentiment: values.sentiment,
    });
    console.log(`Draft ${draft.draftKey} now rev ${draft.revision} (#${draft.draftHash.slice(0, 12)}), status ${draft.status}.`);
    break;
  }
  case "show":
    console.log(await call("GET", `/api/agent/drafts/${need(values.draft, "draft")}`));
    break;
  default:
    console.error("usage: agent <draft|edit|show> --token cda_... [--docket --topic --text | --draft --text]");
    process.exit(1);
}
