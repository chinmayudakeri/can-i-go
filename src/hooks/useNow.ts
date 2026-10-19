"use client";

import { useEffect, useState } from "react";

/** Current time, refreshed every minute so deadlines stay accurate on an open tab. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
