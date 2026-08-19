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

export type TurnChangesSummary = {
  id: string;
  version: 1;
  files: number;
  additions: number;
  deletions: number;
  truncated: boolean;
};

export type TurnChangesArtifact = TurnChangesSummary & {
  patch: string;
  startRevision: string | null;
  endRevision: string | null;
};
