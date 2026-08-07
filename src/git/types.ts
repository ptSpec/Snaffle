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
