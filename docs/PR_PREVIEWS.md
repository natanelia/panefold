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

Run `node --test scripts/pages-*.test.mjs`. The 18 tests run in the Node 22/24 CI jobs and the Pages
planning job. They cover source selection, production preservation, closed/stale/failed previews,
missing and invalid artifacts, unsafe file types, deployment races, comment reuse, local serving,
current-PR commit checks, and the workflow permission boundary.

Use **Actions > Deploy website > Run workflow** on `main` to retry a failed deployment.
Only workflow runs whose ref is `refs/heads/main` can enter the deployment job. Checking out
`main` inside a job does not change the run ref or satisfy an environment branch rule.

### Validate before merge

Changes to the Pages workflows, Pages scripts, or this document trigger **Validate Pages previews**.
This PR check calls the read-only `pages-build.yml` workflow. It builds and assembles the same
static site as production, then opens the assembled main and ready preview workbenches in Chromium
on a localhost server. It checks asset loading, page errors, unavailable pages, and the current
PR's exact commit. Screenshots and a JSON result are in the `pages-preview-validation` artifact.
The assembled site is retained as `site-assembled` for one day.

The validation workflow has no Pages write token, OIDC write token, environment, or comment write
access. It cannot publish a site. The deployment wrapper in `pages.yml` is intentionally not
reusable: branch callers must use the read-only builder instead. This prevents the failure seen
in run `35246775635`, where GitHub rejected branch `ci/pull-request-previews` under the existing
`github-pages` environment protection rules before any deployment step could start.

Before initial merge, a passing validation check proves that the local artifact works, not that
the public preview URL is live. Merge the setup into `main` to enable live preview publication.
This does not require changes to environment or branch protection rules.

References: [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages),
[environment branch rules](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments),
[workflow events and permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows),
and [deploy-pages](https://github.com/actions/deploy-pages). Native Pages preview mode is not
used; the published action describes it as unavailable to the public.
