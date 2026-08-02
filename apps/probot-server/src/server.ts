import { Probot, createNodeMiddleware } from "probot";
import { createServer } from "node:http";

import registerRepositoryStewardApp from "./app.js";

async function main(): Promise<void> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_PRIVATE_KEY;
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const port = Number(process.env.PORT ?? 3000);

  if (!appId || !privateKey || !webhookSecret) {
    throw new Error(
      "GITHUB_APP_ID, GITHUB_PRIVATE_KEY, and GITHUB_WEBHOOK_SECRET are required to start the probot server.",
    );
  }

  const probot = new Probot({
    appId,
    privateKey,
    secret: webhookSecret,
  });

  probot.load(registerRepositoryStewardApp);

  const middleware = await createNodeMiddleware(registerRepositoryStewardApp, { probot });
  const server = createServer((request, response) => {
    void middleware(request, response, () => {
      response.statusCode = 404;
      response.end("Not Found");
    });
  });
  server.listen(port);
  process.stdout.write(`repository-steward probot server listening on port ${port}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
