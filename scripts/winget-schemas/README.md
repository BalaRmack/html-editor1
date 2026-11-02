# winget manifest schemas (vendored)

JSON Schemas for winget manifest v1.6.0, copied verbatim from
[`microsoft/winget-cli`](https://github.com/microsoft/winget-cli/tree/master/schemas/JSON/manifests/v1.6.0)
(MIT licence, © Microsoft Corporation).

They are vendored so `tests/no-browser-install.test.ts` can validate the generated
manifests with `ajv` on Linux, at the same time as the release runner runs
`winget validate` on Windows. Schemas use only internal `#/definitions` refs, so a
plain ajv draft-07 instance is enough — no network, no winget install required.

Keep in sync with the value of `MANIFEST_VERSION` in
`scripts/make-winget-manifest.mjs`; a newer schema needs a new folder and a bump
in both places.
