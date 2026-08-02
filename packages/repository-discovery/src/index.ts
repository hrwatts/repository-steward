import { readFile } from "node:fs/promises";

import {
  repositoryInventorySchema,
  repositorySnapshotSchema,
  type RepositoryInventory,
  type RepositorySnapshot,
} from "../../shared-types/src/index.js";
import { type RepositoryStewardGithubClient } from "../../github-client/src/index.js";

export async function loadRepositoryInventory(path: string): Promise<RepositoryInventory[]> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  return repositoryInventorySchema.array().parse(raw);
}

export async function inspectRepositorySnapshot(
  client: RepositoryStewardGithubClient,
  inventory: RepositoryInventory,
): Promise<RepositorySnapshot> {
  const [owner, repo] = inventory.name.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repository name: ${inventory.name}`);
  }

  const repository = await client.getRepository(owner, repo);
  const headSha = await client.getDefaultBranchHeadSha(owner, repo, repository.defaultBranch);

  const contentsEntries = await Promise.all(
    inventory.paths_of_interest.map(async (path) => {
      const content = await client.getFileText(owner, repo, path, repository.defaultBranch);
      return [path, content] as const;
    }),
  );

  const contents = Object.fromEntries(contentsEntries);
  return repositorySnapshotSchema.parse({
    repository: inventory.name,
    defaultBranch: repository.defaultBranch,
    headSha,
    description: repository.description,
    isPrivate: repository.isPrivate,
    pushedAt: repository.pushedAt,
    language: repository.language,
    stargazerCount: repository.stargazerCount,
    openPullRequestCount: repository.openPullRequestCount,
    hasIssuesEnabled: repository.hasIssuesEnabled,
    contents,
  });
}
