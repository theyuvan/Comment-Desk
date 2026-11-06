import { Suspense } from "react";
import { DocketView } from "./DocketView";

export default function DocketPage({ params }: PageProps<"/dockets/[key]">) {
  return (
    <Suspense fallback={<p className="hint">Loading…</p>}>
      <DocketView params={params} />
    </Suspense>
  );
}
