# logo-hero — checkpoint

- 2026-11-22: Steel wordmark on /login. Added public/logo-hero.webp + logo-hero-poster.webp, src/components/brand/LogoHero.tsx (flag NEXT_PUBLIC_FEATURE_LOGO_HERO), wired into src/app/login/page.tsx in place of the eyebrow. Test e2e/logo-hero.spec.ts written first. No routes, no migrations, middleware untouched.
- Open: verify on the Vercel preview; full e2e run needs the CI env (TERMINAL password secrets).
