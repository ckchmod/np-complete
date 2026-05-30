// THE LOCK — non-triviality gate CLI.
//
// Prints ONE JSON object to stdout (and nothing else) summarizing the solver
// gates for THE LOCK and the tutorials. Exit 0 on success, non-zero on error.
//
//   node scripts/gates.mjs
//
// Note: src/levels.js is imported at runtime; it may not exist yet when this
// file is created. That is expected — running the CLI requires it.

import { THE_LOCK, THE_LOCK_V2, TUTORIALS } from "../src/levels.js";
import { bfsSolve, nonTrivialityReport } from "../src/solver.js";

try {
  const tutorials = TUTORIALS.map((level) => {
    const { solvable, optimalLength } = bfsSolve(level);
    return { id: level.id, solvable, optimal: optimalLength };
  });

  const report = {
    theLock: nonTrivialityReport(THE_LOCK),
    theLockV2: nonTrivialityReport(THE_LOCK_V2),
    tutorials,
    tutorialsAllSolvable: tutorials.every((t) => t.solvable),
  };

  process.stdout.write(JSON.stringify(report) + "\n");
  process.exit(0);
} catch (err) {
  process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
  process.exit(1);
}
