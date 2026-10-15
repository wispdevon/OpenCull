# Welcome page review demo

Branch: demo/rapidraw-welcome. This review branch depends on the combined integration/linux-features branch. It is not a standalone upstream feature.

Run npm ci and npm run dev, then open /?welcome-demo. The development-only query activates a separate opening page; ordinary startup is unchanged. Production builds do not expose it.

The supplied RapidRAW screenshot informed the equal split, monochrome photo and charcoal panel, left-aligned display heading, quiet copy, white primary action, compact secondary row, and bottom-aligned metadata. OpenCull retains its own name, font preference and functional ingest, settings, resume and history actions. The photograph is an original generated asset, not RapidRAW artwork. No remote assets load.

Recent folders and sessions are one click away. Below 760px the decorative photograph is hidden to preserve useful space for controls. The demo intentionally uses a fixed charcoal palette for visual approval; full theme variants can follow the approved direction.

Validation: 57 frontend tests and TypeScript/Vite build pass. Browser screenshots compared at 2048×1120 against the supplied composition; responsive layouts checked at 1280, 760 and 390 pixels. Settings and history navigation verified. Native macOS appearance not tested.
