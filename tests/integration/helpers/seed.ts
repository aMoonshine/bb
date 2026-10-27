import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const TEMPLATE_PATH_ENV = "BB_TEST_GIT_REPO_TEMPLATE";

export interface CreateTestFileOptions {
  content: string;
  filePath: string;
}

export interface TestRepoFile {
  content: string;
  relativePath: string;
}

export interface CreateTestGitRepoOptions {
  files?: TestRepoFile[];
  repoDir: string;
}

export interface RunGitOptions {
  args: string[];
  cwd: string;
}

const DEFAULT_REPO_FILES: TestRepoFile[] = [
  {
    relativePath: "alpha.txt",
    content: "alpha\n",
  },
  {
    relativePath: "beta.md",
    content: "# Beta\n\nInitial content.\n",
  },
];

export async function createTestFile(
  options: CreateTestFileOptions,
): Promise<string> {
  await fs.mkdir(path.dirname(options.filePath), { recursive: true });
  await fs.writeFile(options.filePath, options.content, "utf8");
  return options.filePath;
}

export async function runGit(options: RunGitOptions): Promise<string> {
  const result = await execFile("git", options.args, {
    cwd: options.cwd,
  });
  return result.stdout ?? "";
}

export async function createTestGitRepo(
  options: CreateTestGitRepoOptions,
): Promise<string> {
  const templatePath = process.env[TEMPLATE_PATH_ENV];
  if (options.files === undefined && templatePath !== undefined) {
    await fs.cp(templatePath, options.repoDir, { recursive: true });
    return options.repoDir;
  }
  await fs.mkdir(options.repoDir, { recursive: true });
  await runGit({
    cwd: options.repoDir,
    args: ["init", "--initial-branch", "main"],
  });
  await runGit({
    cwd: options.repoDir,
    args: ["config", "user.email", "integration-tests@example.com"],
  });
  await runGit({
    cwd: options.repoDir,
    args: ["config", "user.name", "BB Integration Tests"],
  });

  for (const file of options.files ?? DEFAULT_REPO_FILES) {
    await createTestFile({
      content: file.content,
      filePath: path.join(options.repoDir, file.relativePath),
    });
  }

  await runGit({
    cwd: options.repoDir,
    args: ["add", "."],
  });
  await runGit({
    cwd: options.repoDir,
    args: ["commit", "-m", "Initial commit"],
  });
  return options.repoDir;
}

export async function setupTestGitRepoTemplate(): Promise<() => Promise<void>> {
  const templatePath = await fs.mkdtemp(
    path.join(tmpdir(), "bb-git-template-"),
  );
  const previousTemplatePath = process.env[TEMPLATE_PATH_ENV];
  try {
    await createTestGitRepo({
      repoDir: templatePath,
      files: DEFAULT_REPO_FILES,
    });
  } catch (error) {
    await fs.rm(templatePath, { recursive: true, force: true });
    throw error;
  }
  process.env[TEMPLATE_PATH_ENV] = templatePath;
  return async () => {
    if (previousTemplatePath === undefined) {
      delete process.env[TEMPLATE_PATH_ENV];
    } else {
      process.env[TEMPLATE_PATH_ENV] = previousTemplatePath;
    }
    await fs.rm(templatePath, { recursive: true, force: true });
  };
}
