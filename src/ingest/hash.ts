import { createHash } from "node:crypto";

/** sha256 of page text, used to skip extraction when a page hasn't changed. */
export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
