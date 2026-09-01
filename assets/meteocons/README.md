# Meteocons weather assets

These files are selected from [Meteocons](https://github.com/basmilius/meteocons) by Bas Milius.

- Animated source package: `@meteocons/svg@0.1.0`
- Reduced-motion source package: `@meteocons/svg-static@0.1.0`
- Style: `fill`
- Selected icons: `clear-day.svg`, `cloudy.svg`, `rain.svg`, `thunderstorms.svg`, `snow.svg`, and `fog.svg`
- License: MIT; see [LICENSE](./LICENSE)

The files are vendored selectively so the extension does not ship the complete icon packages or require a runtime dependency.

To reproduce the selection:

```sh
npm pack @meteocons/svg@0.1.0
npm pack @meteocons/svg-static@0.1.0
```

Extract the six files above from each package's `package/fill/` directory into `animated/` and `static/`, respectively.
