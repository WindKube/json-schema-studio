import type { Format, Operation } from "./patch";

export type Role = "viewer" | "commenter" | "editor" | "owner";
export const ROLES: Role[] = ["viewer", "commenter", "editor", "owner"];
export const atLeast = (role: Role | null | undefined, min: Role) =>
  !!role && ROLES.indexOf(role) >= ROLES.indexOf(min);

export type User = { id: number; login: string; name: string | null; avatarUrl: string | null };

export type SchemaRow = {
  id: number;
  title: string;
  slug: string;
  format: Format;
  ownerLogin: string;
  schemaUri: string | null;
  role: Role;
  latestVersion: string | null;
  draftChanged: boolean;
  people: number;
  examples: number;
  failingExamples: number;
  openSuggestions: number;
  openComments: number;
  updatedAt: number;
};

export type PendingInvite = {
  id: number;
  schemaId: number;
  schemaTitle: string;
  role: Role;
  invitedBy: string;
};

export type SchemaList = { mine: SchemaRow[]; shared: SchemaRow[]; invites: PendingInvite[] };

export type Version = {
  id: number;
  semver: string;
  text: string;
  notes: string;
  exampleResults: ExampleResult[];
  publishedBy: string;
  publishedAt: number;
};

export type ExampleResult = { exampleId: number; name: string; meetsExpectation: boolean };

export type Example = {
  id: number;
  name: string;
  format: Format;
  text: string;
  description: string;
  expect: "valid" | "invalid";
  updatedAt: number;
};

export type SchemaDetail = {
  schema: {
    id: number;
    title: string;
    slug: string;
    format: Format;
    ownerLogin: string;
    publicVersions: boolean;
    sourceUrl: string | null;
    sourceVersion: string | null;
    role: Role;
  };
  draft: { text: string; revision: number; updatedAt: number; updatedBy: string | null };
  versions: Version[];
  examples: Example[];
};

export type Comment = {
  id: number;
  suggestionId: number | null;
  pointer: string;
  parentId: number | null;
  author: string;
  body: string;
  resolvedAt: number | null;
  createdAt: number;
};

export type SuggestionStatus = "open" | "approved" | "changes_requested" | "rejected";

export type Suggestion = {
  id: number;
  number: number;
  title: string;
  body: string;
  author: string;
  baseRevision: number;
  patch: Operation[];
  status: SuggestionStatus;
  decidedBy: string | null;
  decisionNote: string | null;
  createdAt: number;
};

export type Member = {
  userId: number;
  login: string;
  avatarUrl: string | null;
  role: Role;
  since: number;
};

export type Invite = {
  id: number;
  login: string | null;
  avatarUrl: string | null;
  role: Role;
  link: boolean;
  expiresAt: number | null;
};

export type Notification = {
  id: number;
  kind: string;
  payload: { schemaId?: number; text: string; href?: string };
  readAt: number | null;
  createdAt: number;
};

export type CatalogSource = { id: number; name: string; url: string; kind: "catalog" | "schema" };

export type Conflict = {
  error: "conflict";
  revision: number;
  text: string;
  updatedBy: string | null;
};
