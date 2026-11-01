# Assignment UAT checklist

1. Start the backend and frontend as documented in README.
2. Upload a small ZIP containing JavaScript or TypeScript source.
3. Confirm file, symbol and relationship counts.
4. Inspect the session CodeGraph explorer.
5. Ask about a known symbol; inspect the source citation.
6. Repeat the same question and verify a cache hit.
7. End the session and verify that the old token is rejected.
8. Upload a different ZIP and confirm the prior graph is absent.
9. Upload an invalid archive and verify a controlled error.
10. If an LLM endpoint is configured, verify a generated explanation.

These are manual acceptance steps, not an assertion that browser UAT has passed.
