// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/** The directory-level loading skeleton, shown while the staff client list arrives. */
import { PageSkeleton } from "../components/PageSkeleton";

export default function Loading() {
  return <PageSkeleton tiles={8} />;
}
