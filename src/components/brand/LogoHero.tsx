/* eslint-disable @next/next/no-img-element */
// The Glastonbury wordmark in polished steel, rendered in Blender (Nov 2026).
// An animated WebP that plays once and holds on the finished logo; the still
// is shown instead under prefers-reduced-motion. Both are root-level files in
// /public, so the middleware serves them on /login without a session.

export const LOGO_HERO_ENABLED = process.env.NEXT_PUBLIC_FEATURE_LOGO_HERO !== 'false';

export function LogoHero({ className }: { className?: string }) {
  return (
    <picture className={className} data-testid="logo-hero">
      <source srcSet="/logo-hero-poster.webp" media="(prefers-reduced-motion: reduce)" />
      <img
        src="/logo-hero.webp"
        alt="The Glastonbury Group"
        width={840}
        height={310}
        decoding="async"
        fetchPriority="high"
        style={{ display: 'block', width: '100%', height: 'auto' }}
      />
    </picture>
  );
}
