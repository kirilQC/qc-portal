// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { Suspense } from "react";
import BrainDocs from "../../components/BrainDocs";
import "../calls/calls.css";

/**
 * Campaign messaging, read from the client's own QC Brain folder.
 *
 * The same reader as the weekly calls, pointed at a different folder — these are two folders of
 * markdown read one document at a time, and building them twice would let them drift apart.
 */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <BrainDocs
        folder="messaging"
        title="Messaging"
        empty="That folder is there, but no messaging documents have been written into it yet."
      />
    </Suspense>
  );
}
