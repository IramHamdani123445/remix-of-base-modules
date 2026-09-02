# Convert the Benefits Claims & Workbaskets Reference to Word (.docx)

Convert `docs/benefits/claims-workbaskets-roles-notifications.md` (721 lines, 40 KB) into a downloadable Word document.

## Deliverable

`Claims-and-Workbaskets-in-Benefit-Management.docx` delivered to `/mnt/documents/` so it appears in chat for download.

## How it will be produced

1. Convert the markdown to DOCX with pandoc, preserving headings, tables, code blocks and the ASCII lifecycle diagram.
2. Post-check the output: page size, table rendering, and that the ASCII diagrams sit in a monospace font so alignment survives.
3. Render the DOCX to PDF and convert every page to an image to verify layout (tables not clipped, code blocks intact, heading structure correct), fixing and re-generating if anything is broken.

## Notes

- The source markdown is not modified; this produces a separate Word copy.
- Content is carried over as-is (the document was already verified against the live database and code).
- If you also want `product-version-governance-flow.md` converted, say so and it will be included in the same pass.
