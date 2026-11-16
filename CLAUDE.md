# Working in this repository

## Branch workflow

- **`dev` comes first.** All changes go to `dev`. Test users run `dev`.
- **`main` is the release branch.** Changes are transferred from `dev` to `main` only when everything on `dev` is confirmed good. Never open a pull request against `main` or merge into it unless explicitly asked.
- Start work branches from the latest `dev`, and open pull requests with `dev` as the base.
- Read and verify the app's behaviour against `dev`, not `main` — `dev` is usually ahead.

## Backlog

- The backlog is kept as GitHub issues on this repository.
