// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { Suspense } from "react";
import BrainDocs from "../../components/BrainDocs";
import "./calls.css";

/** Weekly calls, read from the client's own QC Brain folder. */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <BrainDocs
        folder="calls"
        title="Weekly calls"
        empty="That folder is there, but no call notes have been written into it yet."
      />
    </Suspense>
  );
}
