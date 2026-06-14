import { runRulesTests } from "./rules-test-suite.js";

const report = runRulesTests();

for (const result of report.results) {
  const mark = result.ok ? "PASS" : "FAIL";
  console.log(`${mark} ${result.name}`);
  if (!result.ok) {
    console.error(result.error);
  }
}

console.log(`\n${report.passed}/${report.total} tests passed.`);

if (report.failed > 0) {
  process.exitCode = 1;
}

