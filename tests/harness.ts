type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

const registry: TestCase[] = [];

export function test(name: string, run: () => void | Promise<void>): void {
  registry.push({ name, run });
}

export async function runRegisteredTests(): Promise<void> {
  let failures = 0;

  for (const entry of registry) {
    try {
      await entry.run();
      process.stdout.write(`PASS ${entry.name}\n`);
    } catch (error) {
      failures += 1;
      process.stderr.write(`FAIL ${entry.name}\n`);
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    }
  }

  if (failures > 0) {
    throw new Error(`${failures} test(s) failed.`);
  }
}
