import type { ReactNode } from "react";

type Props = {
  kind: "loading" | "error" | "empty";
  title: string;
  children?: ReactNode;
};

/** One consistent look for loading, error, and empty states. */
export function StateMessage({ kind, title, children }: Props) {
  return (
    <div
      className={`state state-${kind}`}
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "loading" ? "polite" : undefined}
    >
      {kind === "loading" && <span className="spinner" aria-hidden />}
      <p className="state-title">{title}</p>
      {children && <div className="state-body">{children}</div>}
    </div>
  );
}
