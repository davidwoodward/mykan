// In-app help for GitHub setup (KANBAN-28): what token mykan needs and how to
// make one. The single content source for the "?" dialog (components/GithubHelp.tsx)
// placed on every GitHub config surface; there is deliberately no separate
// how-to doc to drift from it.
//
// Pure data, no React, so it runs under `node --test`. Keep it matched to what
// the code actually does (lib/github.ts, lib/github-core.ts,
// lib/github-writeback.ts) and to GitHub's current docs (checked 2026-09-17):
// https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens

/** A run of text inside a help line. Plain strings are plain text. */
export type HelpSpan =
  | string
  | { strong: string }
  | { code: string }
  | { link: string; href: string };

/** One paragraph, list item or step: a sequence of spans. */
export type HelpLine = HelpSpan[];

export interface HelpSection {
  id: string;
  title: string;
  /** Paragraphs shown before any list. */
  intro?: HelpLine[];
  /** Numbered steps. */
  steps?: HelpLine[];
  /** Bulleted points. */
  bullets?: HelpLine[];
  /** Show the required-permissions table ({@link GITHUB_REQUIRED_PERMISSIONS}) after the intro. */
  permissions?: boolean;
}

/** GitHub's "new fine-grained token" page, with no fields filled in. */
export const GITHUB_NEW_TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";

/**
 * The same page pre-filled for mykan: name, description and Issues: read & write
 * (GitHub adds Metadata: read with it). GitHub documents these query parameters
 * ("Pre-filling fine-grained personal access token details using URL
 * parameters"). No `target_name`, so the resource owner defaults to your own
 * account; no `expires_in`, so you choose the expiration on the form.
 */
export const GITHUB_NEW_TOKEN_PREFILLED_URL =
  `${GITHUB_NEW_TOKEN_URL}?` +
  new URLSearchParams({
    name: "mykan",
    description: "mykan: import issues and close/reopen them on Done",
    issues: "write",
  }).toString();

export const GITHUB_PAT_DOCS_URL =
  "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token";

/** The token permissions mykan needs, and why. Nothing else is used. */
export const GITHUB_REQUIRED_PERMISSIONS: { name: string; access: string; why: string }[] = [
  {
    name: "Metadata",
    access: "Read-only",
    why: "Every fine-grained token has it. GitHub adds it for you.",
  },
  {
    name: "Issues",
    access: "Read and write",
    why: "Read imports open issues and refreshes a card. Write closes the issue when its card moves to Done, and reopens it when it leaves Done.",
  },
];

export const GITHUB_HELP_TITLE = "Setting up GitHub";

export const GITHUB_HELP_SECTIONS: HelpSection[] = [
  {
    id: "what",
    title: "What mykan needs",
    permissions: true,
    intro: [
      [
        "One ",
        { strong: "fine-grained personal access token" },
        " for each GitHub account or organization whose issues you want in mykan. You paste it into ",
        { strong: "Connect GitHub account" },
        " (the GitHub icon in the top bar). It is stored encrypted, only for you, and never shown again.",
      ],
    ],
  },
  {
    id: "not-oauth",
    title: "You don't need an OAuth App",
    bullets: [
      [
        "GitHub's ",
        { strong: "OAuth Apps" },
        " page (Developer settings) is for apps that sign people in with GitHub. mykan doesn't use one: no app to register, no client secret, no callback URL. Just the token.",
      ],
      [
        "Use a ",
        { strong: "fine-grained" },
        " token, not a classic one (",
        { strong: "Tokens (classic)" },
        ").",
      ],
      [
        "mykan's ",
        { strong: "OAuth for MCP" },
        " (how Claude connects to mykan) signs in with Google. It has nothing to do with GitHub.",
      ],
    ],
  },
  {
    id: "create",
    title: "Create the token",
    intro: [
      [
        { link: "Open GitHub's new-token form pre-filled for mykan", href: GITHUB_NEW_TOKEN_PREFILLED_URL },
        " (name, description and Issues: read and write filled in), then check each field below. Or get there yourself: your profile picture → ",
        { strong: "Settings" },
        " → ",
        { strong: "Developer settings" },
        " → ",
        { strong: "Personal access tokens" },
        " → ",
        { strong: "Fine-grained tokens" },
        " → ",
        { strong: "Generate new token" },
        ".",
      ],
    ],
    steps: [
      [
        { strong: "Token name:" },
        " anything you'll recognise, such as ",
        { code: "mykan" },
        " or ",
        { code: "mykan-acme" },
        ". Make one token per account.",
      ],
      [
        { strong: "Expiration:" },
        " GitHub defaults to 30 days, so pick something longer, such as a year. No expiration is allowed unless your organization sets a maximum lifetime. When a token lapses, mykan asks you to reconnect.",
      ],
      [
        { strong: "Resource owner:" },
        " the account or organization that owns the repos. It defaults to you, so switch it to the organization for an org's repos. One token covers one owner.",
      ],
      [
        { strong: "Repository access:" },
        " ",
        { strong: "Only select repositories" },
        " (just the repos you'll link to areas) or ",
        { strong: "All repositories" },
        ". mykan's repo picker only lists what the token can see.",
      ],
      [
        { strong: "Permissions:" },
        " under Repository permissions set ",
        { strong: "Issues" },
        " to ",
        { strong: "Read and write" },
        ". ",
        { strong: "Metadata: Read-only" },
        " comes with it. Nothing else is needed (not Contents, not Pull requests).",
      ],
      [
        "Click ",
        { strong: "Generate token" },
        ", copy it (GitHub shows it only once), and paste it into mykan with the account or org name.",
      ],
    ],
  },
  {
    id: "org",
    title: "Organization repos",
    bullets: [
      [
        "An organization can require an owner to approve fine-grained tokens. Until approved the token is ",
        { strong: "pending" },
        " and can only read public repos, so private repos won't appear in the repo picker and importing one fails with \"can't see it\". Ask an org owner to approve it (an owner's own token is approved automatically).",
      ],
      [
        "Fine-grained tokens can't reach an organization you're only an outside collaborator on.",
      ],
    ],
  },
  {
    id: "connect",
    title: "Connect and link",
    steps: [
      [
        "Top bar GitHub icon → enter the ",
        { strong: "account or org" },
        " name and paste the token → ",
        { strong: "Connect" },
        ". mykan checks the token with GitHub first.",
      ],
      [
        "On the project, the pencil beside its name (Edit project) → ",
        { strong: "GitHub account" },
        ": pick the account this project's issues come from.",
      ],
      [
        { strong: "Areas" },
        " → ",
        { strong: "+ repo" },
        " on an area → pick a repo. ",
        { strong: "Import" },
        " brings its open issues in as Not started cards in that area.",
      ],
    ],
  },
  {
    id: "reconnect",
    title: "When it stops working",
    bullets: [
      [
        "If GitHub rejects your token (expired, revoked, or missing a permission), mykan marks it ",
        { strong: "needs reconnect" },
        " for you only: the GitHub panel shows it with a red dot on the icon, and Import says Reconnect. Nobody else's connection is affected.",
      ],
      [
        "Make a new token (steps above), then ",
        { strong: "Reconnect" },
        " in the GitHub panel and paste it.",
      ],
      [
        "A card marked ",
        { strong: "not synced" },
        " means its issue wasn't closed or reopened. Reconnect, then click the badge to retry.",
      ],
      [
        "Each person connects their own token. mykan never uses someone else's.",
      ],
    ],
  },
];

/** Every external link in the help, for checks. */
export function helpLinks(sections: HelpSection[] = GITHUB_HELP_SECTIONS): string[] {
  const out: string[] = [];
  for (const s of sections) {
    for (const line of [...(s.intro ?? []), ...(s.steps ?? []), ...(s.bullets ?? [])]) {
      for (const span of line) {
        if (typeof span !== "string" && "link" in span) out.push(span.href);
      }
    }
  }
  return out;
}
