import Link from "next/link";
import { StateMessage } from "@/components/StateMessage";

export default function NotFound() {
  return (
    <StateMessage kind="empty" title="Page not found">
      <Link href="/">Back to Discover</Link>
    </StateMessage>
  );
}
