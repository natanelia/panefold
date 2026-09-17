# Pull request demo previews

The Pages workflow publishes the main website and separate workbench previews in one deployment.
The production workbench always comes from an exact commit on `main`. A PR never replaces it.

## Open a preview

After a successful deployment, the pull request has one **Demo preview** bot comment. It contains
an **Open preview workbench** link and the exact PR commit that was built.

- Preview index: `https://natanelia.github.io/panefold/previews/`
- PR landing page: `https://natanelia.github.io/panefold/previews/pr-33/`
- Direct workbench: `https://natanelia.github.io/panefold/previews/pr-33/workbench/`
- Main workbench: `https://natanelia.github.io/panefold/workbench/`

Replace `33` with the pull request number. Previews contain the standalone workbench, not a second
copy of the marketing site. The landing page and `preview.json` identify the built commit.

**Use a separate private browser window for preview tests.** GitHub Pages paths do not isolate
origins. The existing demos share their IndexedDB and local-storage names. Preview interactions
can change the saved demo layout in the same browser profile. Do not load sensitive data into a
preview. The workflow does not modify application source to hide this limitation.

## Lifecycle

Once this workflow is merged into `main`, opening, reopening, pushing to, or changing the draft
state of a same-repository PR starts a deployment. Draft PRs are included. Closing or merging a
PR removes its preview in the next successful deployment. Pushes to `main` and manual **Run
workflow** requests also refresh the complete site.

Every run reads the current open PRs, then builds production and each preview on separate runners.
It rebuilds all open previews rather than retaining old files on a deployment branch. This avoids
lost previews when production publishes and removes closed previews without separate storage.
It costs additional build time as the number of open PRs grows.

A failed PR build gets an unavailable landing page; other previews and production can still be
published. A failed production build or invalid artifact stops deployment and leaves the live
site unchanged. Main is checked again before assembly to prevent an older run from reverting a
newer production commit. PRs that changed during the build do not publish stale workbench code.

The workflow updates its existing bot comment instead of adding a comment on every push. Comments
are posted only after successful Pages deployment and another PR state/commit check. A closed PR's
comment is marked removed after its preview is removed. The Pages run summary also links to the
preview index.

## Trust and permissions

`pull_request_target` is used only to select the trusted workflow from the base repository.
The plan, assembly, and comment scripts use `github.workflow_sha`, never the PR checkout.
PR code executes only in a separate, read-only build job, with no secrets, no deployment token,
no saved checkout credentials, and no shared dependency cache. Deployment runs in a fresh job
with only `pages: write` and `id-token: write`. Comment writes are in another job.

Only PR branches in this repository are published. Fork PRs are excluded because their JavaScript
would run on the main site's origin. Repository write access is the preview publishing trust
boundary. Do not expand this to untrusted forks without a separate-origin hosting design.

Production artifacts are downloaded by the artifact ID returned by the production upload, not by
an artifact name that a PR build could impersonate. The assembler copies only regular static
files, rejects symbolic links, hard links and repository metadata, and never executes artifact
contents. Assembly has a total limit of 20,000 files and 800 MiB. At most 20 open previews build,
with four concurrent preview builds. Exceeding the preview limit fails rather than silently
removing an existing preview. Change these budgets explicitly when required.

Deployment uses the existing `github-pages` environment and its protection rules. It does not
change environment policies, repository settings, or branch protection. No external hosting
account, personal token, or repository secret is required.

## Checks and operation

Run `node --test scripts/pages-previews.test.mjs`. The Node 22/24 CI jobs and the Pages planning
job run this suite. It covers source selection, production preservation, closed/stale/failed
previews, missing and invalid artifacts, unsafe file types, deployment races, and comment reuse.

Use **Actions > Deploy website > Run workflow** on `main` to retry a failed deployment. The
workflow is also reusable through `workflow_call` for a maintainer-controlled validation run.
The called workflow still obeys the `github-pages` environment rules. Before initial merge,
a successful branch validation is not evidence that future PR events are enabled on `main`.

References: [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages),
[workflow events and permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows),
and [deploy-pages](https://github.com/actions/deploy-pages). Native Pages preview mode is not
used; the published action describes it as unavailable to the public.
