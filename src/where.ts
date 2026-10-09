// Where a claim is being made from. Recorded on the claim so another agent can
// see which checkout holds the path before they write into it.

import { execFileSync } from "node:child_process";
import { loadMachine } from "./machine.ts";

/** This computer's label and the git checkout, when either is visible. */
export function claimPlace(): { machine?: string; checkout?: string } {
  const machine = loadMachine()?.label;
  let checkout: string | undefined;
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (top) checkout = top;
  } catch {
    checkout = undefined;
  }
  return { ...(machine ? { machine } : {}), ...(checkout ? { checkout } : {}) };
}
