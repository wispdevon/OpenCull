# Independent upstream PR checklist

- [x] Record base and preserved remote refs (`a8c7f32`; `/tmp/opencull-independent-preserved-refs.txt`).
- [ ] GPU builds/tests from upstream with no other idea prerequisite.
- [ ] Ingest builds/tests from upstream with no unrelated GPU/AI/interface code.
- [ ] AI builds/tests from upstream; CPU mode independent of GPU PR.
- [ ] Interface builds/tests from upstream without session/AI changes being assumed.
- [ ] Shared contracts and pairwise/cumulative merge compatibility verified.
- [ ] Native no-bundle builds and relevant runtime checks passed; platform limitations recorded.
- [ ] Diff scopes, defaults, updater/version/repository policy verified.
- [ ] Scoped draft PRs opened upstream; combined PR #3 retained and marked reference/superseded.
- [ ] Final remote refs/PR state/coverage audit passed.
