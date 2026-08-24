export type GitFileChange = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  exists: boolean;
  editable: boolean;
};

export type GitChanges = {
  state: "ready" | "unavailable" | "not-repository" | "error";
  message?: string;
  branch: string | null;
  files: GitFileChange[];
  additions: number;
  deletions: number;
};

export type GitFileContents = {
  current: string;
  original: string;
  lineEnding: "lf" | "crlf";
};

export type GitDiffPreview = {
  lines: string[];
  truncated: boolean;
};

export type GitWalkthroughTarget =
  | { kind: "working" }
  | { kind: "branch"; baseBranch: string };

export type GitWalkthroughOptions = {
  currentBranch: string | null;
  defaultBranch: string | null;
  branches: string[];
};

export type GitWalkthroughChange = {
  id: string;
  kind: "committed" | "staged" | "unstaged" | "untracked";
  path: string;
  patch: string;
  truncated: boolean;
};

export type GitWalkthroughContext = {
  title: string;
  detail: string;
  evidence: string;
  changes: GitWalkthroughChange[];
  target: GitWalkthroughTarget;
  snapshot: string;
};
