// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The instant a tab is clicked, this shows — a shimmer shaped like the page arriving — so the previous
 * tab never lingers on screen during the navigation. Each page then keeps the same skeleton up while its
 * own data loads, so the two hand off seamlessly.
 */
import { PageSkeleton } from "../../components/PageSkeleton";

export default function Loading() {
  return <PageSkeleton tiles={8} />;
}
