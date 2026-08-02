import { App, Octokit } from "octokit";

export interface GithubRepositoryDetails {
  defaultBranch: string;
  description: string | null;
  isPrivate: boolean;
  pushedAt: string | null;
  language: string | null;
  stargazerCount: number;
  openPullRequestCount: number;
  hasIssuesEnabled: boolean;
}

export interface DashboardIssueTarget {
  owner: string;
  repo: string;
  issueNumber: number;
}

export interface GithubIssueDetails {
  body: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface RepositoryStewardGithubClient {
  getRepository(owner: string, repo: string): Promise<GithubRepositoryDetails>;
  getDefaultBranchHeadSha(owner: string, repo: string, branch: string): Promise<string | null>;
  getFileText(owner: string, repo: string, path: string, ref?: string): Promise<string | null>;
  getIssue(target: DashboardIssueTarget): Promise<GithubIssueDetails>;
  updateIssueBody(target: DashboardIssueTarget, body: string): Promise<GithubIssueDetails>;
}

type GithubClientOptions = {
  token?: string;
  appId?: string;
  privateKey?: string;
  installationId?: string;
  userAgent?: string;
};

function decodeContent(content: string, encoding?: string): string {
  if (encoding === "base64") {
    return Buffer.from(content, "base64").toString("utf8");
  }
  return content;
}

export class OctokitGithubClient implements RepositoryStewardGithubClient {
  private readonly octokitPromise: Promise<Octokit>;
  private readonly anonymousOctokitPromise: Promise<Octokit>;

  public constructor(options: GithubClientOptions) {
    this.octokitPromise = createOctokit(options);
    this.anonymousOctokitPromise = Promise.resolve(new Octokit({ userAgent: options.userAgent ?? "repository-steward/0.1.0" }));
  }

  public async getRepository(owner: string, repo: string): Promise<GithubRepositoryDetails> {
    return this.withReadFallback(async (octokit) => {
      const response = await octokit.rest.repos.get({ owner, repo });
      const pulls = await octokit.rest.pulls.list({
        owner,
        repo,
        state: "open",
        per_page: 100,
      });

      return {
        defaultBranch: response.data.default_branch,
        description: response.data.description,
        isPrivate: response.data.private,
        pushedAt: response.data.pushed_at,
        language: response.data.language,
        stargazerCount: response.data.stargazers_count,
        openPullRequestCount: pulls.data.length,
        hasIssuesEnabled: response.data.has_issues,
      };
    });
  }

  public async getDefaultBranchHeadSha(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<string | null> {
    return this.withReadFallback(async (octokit) => {
      try {
        const response = await octokit.rest.repos.getBranch({
          owner,
          repo,
          branch,
        });
        return response.data.commit.sha;
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
    });
  }

  public async getFileText(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<string | null> {
    return this.withReadFallback(async (octokit) => {
      try {
        const response = await octokit.rest.repos.getContent({
          owner,
          repo,
          path,
          ...(ref ? { ref } : {}),
        });

        if (Array.isArray(response.data)) {
          return null;
        }

        if (!("content" in response.data) || typeof response.data.content !== "string") {
          return null;
        }

        return decodeContent(response.data.content, response.data.encoding);
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
    });
  }

  public async updateIssueBody(target: DashboardIssueTarget, body: string): Promise<GithubIssueDetails> {
    const octokit = await this.octokitPromise;
    const response = await octokit.rest.issues.update({
      owner: target.owner,
      repo: target.repo,
      issue_number: target.issueNumber,
      body,
    });

    return {
      body: response.data.body ?? "",
      updatedAt: response.data.updated_at,
      htmlUrl: response.data.html_url,
    };
  }

  public async getIssue(target: DashboardIssueTarget): Promise<GithubIssueDetails> {
    return this.withReadFallback(async (octokit) => {
      const response = await octokit.rest.issues.get({
        owner: target.owner,
        repo: target.repo,
        issue_number: target.issueNumber,
      });

      return {
        body: response.data.body ?? "",
        updatedAt: response.data.updated_at,
        htmlUrl: response.data.html_url,
      };
    });
  }

  private async withReadFallback<T>(operation: (octokit: Octokit) => Promise<T>): Promise<T> {
    try {
      return await operation(await this.octokitPromise);
    } catch (error) {
      if (!isBadCredentials(error)) {
        throw error;
      }

      return operation(await this.anonymousOctokitPromise);
    }
  }
}

async function createOctokit(options: GithubClientOptions): Promise<Octokit> {
  const userAgent = options.userAgent ?? "repository-steward/0.1.0";

  if (options.appId && options.privateKey && options.installationId) {
    const app = new App({
      appId: options.appId,
      privateKey: options.privateKey,
      userAgent,
    });

    return app.getInstallationOctokit(Number(options.installationId));
  }

  if (options.token) {
    return new Octokit({
      auth: options.token,
      userAgent,
    });
  }

  return new Octokit({ userAgent });
}

function isNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return "status" in error && Number((error as { status?: number }).status) === 404;
}

function isBadCredentials(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return "status" in error && Number((error as { status?: number }).status) === 401;
}
