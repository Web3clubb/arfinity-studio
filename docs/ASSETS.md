# ARFINITY Studio: visual asset list

## Current images (reused ARFINITY work)

All images are NOOR campaign shots from ARFINITY's own portfolio. They are hosted on `i.ibb.co` exactly as on the previous site.

| Used as | File (current URL) | Notes |
|---|---|---|
| Opening / hero | `IMG-6157.png` (dark portrait) | Also used for OG/Twitter image |
| World 01 The Surreal | `IMG-6151.png` (luxury jewelry) | Warm gold grade applied in CSS |
| World 02 The Dream | `IMG-6154.png` (beauty editorial) | Misty blue, lavender and pink light in CSS |
| World 03 The Future | `IMG-6153.png` (fashion editorial) | Electric blue tint and grid overlay in CSS |
| Work gallery | `IMG-6150.png`, `IMG-6154.png`, `IMG-6153.png` | |

Please confirm the mapping by eye. Each world's grade is applied with CSS, so swapping a photo only changes the file reference.

**Recommended next step:** download the five originals, export each as WebP at 1200 px and 800 px wide, and place them under `assets/img/`. This removes the hotlinks and lowers initial load. Then update `src` and `srcset` in `index.html`.

## Images still needed (art-directed, for each world)

The worlds currently reuse the existing photos. These new shots would make each world stronger:

1. **Opening (hero), 2400×1500, landscape and portrait crops.** A single dramatic object or figure in a vast, dark space. Warm light falling from one side.
2. **World 01 The Surreal, 2400×1500.** An oversized luxury product (perfume bottle, watch or jewelry) floating over an impossible desert or architecture. Dramatic shadows, sand and muted gold.
3. **World 02 The Dream, 2400×1500.** A product or person inside a dreamlike landscape: misty blue hour, lavender haze, soft pink flowers, silver light.
4. **World 03 The Future, 2400×1500.** A virtual brand ambassador or futuristic product in graphite and electric-blue environments with subtle chrome reflections.
5. **OG share image, 1200×630.** Hero composition with the wordmark. Replace the current `og:image` once it exists.

Generating these with the `media-gen` workflow (Fal.ai) needs an API key from you. Tell me if you want that.

## Placeholder policy

Nothing in the page is a generic stock image. If an image fails to load, the page keeps the dark background and its text stays readable. Do not add stock photos as placeholders.
