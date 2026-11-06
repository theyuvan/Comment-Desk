"use client";

import { useState } from "react";
import type { CommentCreated, DocketInfo } from "@commentdesk/shared";
import { WorldVerifyButton } from "./WorldVerifyButton";

/**
 * Human-typed path. Typing it yourself is the review, so one IDKit check at submit is
 * proportionate. The proof's signal is bound to these exact words; the backend posts
 * the text it stored when it issued the request, not whatever the browser sends later.
 */
export function HumanCommentComposer({ docket, onPosted }: { docket: DocketInfo; onPosted: (c: CommentCreated) => void }) {
  const [topic, setTopic] = useState(docket.topics[0] ?? "");
  const [text, setText] = useState("");
  const [posted, setPosted] = useState<CommentCreated | null>(null);

  return (
    <div className="composer composer-human">
      <label className="field">
        <span>Topic</span>
        <select value={topic} onChange={(e) => setTopic(e.target.value)}>
          {docket.topics.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Your comment</span>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPosted(null);
          }}
          rows={5}
          maxLength={4000}
          placeholder="Write it in your own words."
        />
      </label>
      <WorldVerifyButton<CommentCreated>
        input={{ purpose: "comment", docketKey: docket.key, topic, text }}
        verifyPath="/api/world/verify/comment"
        label="Verify with World ID & post"
        disabled={!text.trim()}
        onVerified={(c) => {
          setPosted(c);
          setText("");
          onPosted(c);
        }}
      />
      {posted && <p className="ok">Posted as {posted.ensName}</p>}
    </div>
  );
}
