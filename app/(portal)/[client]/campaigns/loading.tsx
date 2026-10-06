// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/** Shown the instant this tab is clicked: a shimmer shaped like the page arriving, which the page keeps up while its data loads. */
import { ListSkeleton } from "../../../components/PageSkeleton";

export default function Loading() {
  return <ListSkeleton rows={6} tiles={5} />;
}
