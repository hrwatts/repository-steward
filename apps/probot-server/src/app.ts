import pino from "pino";
import type { Probot } from "probot";

const logger = pino({ name: "repository-steward-probot" });

const stewardLabel = "repository-steward";

export default function registerRepositoryStewardApp(app: Probot): void {
  app.onAny(async (context) => {
    const action = "action" in context.payload ? context.payload.action : undefined;
    logger.info(
      {
        event: context.name,
        action,
      },
      "received webhook event",
    );
  });

  app.on(["installation.created", "installation.deleted", "installation.suspend", "installation.unsuspend"], async (context) => {
    logger.info(
      {
        event: context.name,
        action: context.payload.action,
        installation: context.payload.installation?.id,
      },
      "installation lifecycle event",
    );
  });

  app.on(["pull_request.opened", "pull_request.synchronize", "pull_request.reopened", "pull_request.closed"], async (context) => {
    const labels = context.payload.pull_request.labels.map((label) => label.name);
    const managedBySteward = labels.includes(stewardLabel);

    logger.info(
      {
        repository: context.payload.repository.full_name,
        pr: context.payload.pull_request.number,
        headSha: context.payload.pull_request.head.sha,
        managedBySteward,
      },
      "pull request lifecycle event",
    );
  });

  app.on(["pull_request_review.submitted", "check_suite.completed", "workflow_run.completed"], async (context) => {
    logger.info(
      {
        event: context.name,
        repository: "repository" in context.payload ? context.payload.repository.full_name : undefined,
      },
      "review or validation event",
    );
  });

  app.on("github_app_authorization.revoked", async (context) => {
    logger.warn(
      {
        account: context.payload.sender.login,
      },
      "github app authorization revoked; user-attributed actions must stop",
    );
  });
}
