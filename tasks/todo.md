# Independent upstream PR checklist

- [x] Record base and preserved remote refs (`a8c7f32`; `/tmp/opencull-independent-preserved-refs.txt`).
- [x] GPU builds/tests from upstream with no other idea prerequisite (frontend + CPU/CUDA library suites + real GPU file-model check; final desktop/CI gate below).
- [x] Ingest builds/tests from upstream with no unrelated GPU/AI/interface code.
- [x] AI builds/tests from upstream; CPU mode independent of GPU PR.
- [x] Interface builds/tests from upstream without session/AI changes being assumed.
- [x] Shared contracts and pairwise/cumulative merge compatibility verified.
- [ ] Native no-bundle builds and relevant runtime checks passed; platform limitations recorded.
- [ ] Diff scopes, defaults, updater/version/repository policy verified.
- [x] Scoped draft PRs opened upstream; combined PR #3 retained and marked reference/superseded.
- [ ] Final remote refs/PR state/coverage audit passed.
