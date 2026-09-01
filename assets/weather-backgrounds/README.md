# Weather card backgrounds

These six local weather backgrounds were generated for the Chrome Home Plugin weather card.

## Generation settings

- Tool: `api-image` provider workflow
- Model: `gpt-image-2`
- Requested source size: `2048x1152`
- Quality: `high`
- Background: `opaque`
- Source output: lossless PNG returned by the provider
- Final processing: center crop to 4:1, resize to `1600x400`, encode as JPEG with FFmpeg quality level 4

## Shared prompt baseline

Photorealistic cinematic weather photography for an ultra-wide 4:1 dashboard card background. Use an expansive real sky, natural crisp atmospheric detail, restrained premium color grading, and a composition designed for a center crop from 16:9. Keep visual detail near the outer edges and leave the central horizontal band relatively calm for readable white UI text. Do not include text, logos, people, buildings, objects, illustrations, synthetic gradients, or bokeh.

## Condition differences

- `clear.jpg`: transparent deep blue daytime sky, fine high-altitude wisps, warm natural sunlight entering diagonally from the upper left.
- `cloudy.jpg`: layered cumulus and stratocumulus clouds with strong depth, silver-gray and cool blue tones, soft filtered daylight.
- `rain.jpg`: slate-blue rain clouds, visible diagonal rain streaks, wet atmosphere, and a distant rainfall curtain; no lightning.
- `storm.jpg`: dark cumulonimbus structure, one branching lightning bolt in the right third, charcoal and restrained violet-blue tones.
- `snow.jpg`: cold blue-gray winter sky, natural snowflakes at different depths, and softly illuminated cloud layers.
- `fog.jpg`: layered natural mist and low cloud bands, muted cool gray-green and blue tones, and soft diffused daylight.

To replace one condition while preserving consistency, reuse the shared baseline unchanged and replace only the corresponding condition paragraph.
