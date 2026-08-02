import "./unit/audit-store.test.js";
import "./unit/drift-detectors.test.js";
import "./unit/notification-service.test.js";
import "./unit/policy-engine.test.js";

import { runRegisteredTests } from "./harness.js";

runRegisteredTests().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
