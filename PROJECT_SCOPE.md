# AboveTheFog — Project Brief

Status: Draft project information. This is not an approved implementation specification.

## Confirmed MVP decisions — 29 October 2026

These decisions supersede conflicting proposals elsewhere in this draft:

- The MVP is a mobile-friendly website.
- Fog height is entered manually. Users read the relevant regional weather information from MeteoSwiss themselves; the website does not fetch or interpret weather data.
- A single selected altitude is visualized across the whole of Switzerland. Regional fog heights may differ; the selected value is an altitude scenario, not a nationwide weather estimate.
- The initial scope is the visualization itself. Automatic fog estimates and regional weather modelling are outside this MVP.
- Agreed technology stack: React for the interface, TypeScript for application code, Vite for development and static production builds, and OpenLayers for mapping and the altitude overlay. No application code has been created.
- Technology selection must prioritize established, commonly used tools, long-term maintainability, and a small, reviewable dependency tree. Use ordinary CSS and built-in React state for the MVP; additional packages need a concrete justification. Pin dependency versions, review transitive dependencies, and apply security updates deliberately. Serve application JavaScript with the website rather than loading it from third-party CDNs at runtime.
- Plan for static hosting without an application server or database. The agreed elevation source is swisstopo's swissALTI3D. Source resolution, data preparation, browser delivery format, and the hosting provider remain to be determined.
- Elevation data reference: https://www.swisstopo.admin.ch/en/height-model-swissalti3d . Swisstopo supplies 0.5 m and 2 m grids as Cloud Optimized GeoTIFF files. These source files must not be assumed to be directly suitable for an interactive nationwide overlay without a delivery and performance experiment.
- Swisstopo's open-data terms permit processing, redistribution, and commercial use with source attribution: https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices . Any prepared elevation tiles must retain the required attribution.

## Product idea

A Switzerland-focused map that uses swisstopo maps and a subtle overlay to make terrain likely to be beneath the fog less prominent. Areas likely to emerge above the fog remain clearly visible.

The central question is: **Which nearby areas are likely above the fog?**

## Problem

Knowing a regional fog altitude or seeing a broad weather region does not make it easy to identify a particular ridge, hillside, or walking area above the fog. Users must mentally combine weather information with terrain elevations and often check several sources.

The user found the broad areas in Sunmap unhelpful for this purpose and reported that the Geometa Lab fog map did not work. An equivalent fog overlay in Swiss Pro Map has not been verified. These observations suggest an experience gap; they do not establish that no competing solution exists.

## Intended users — hypotheses to validate

- Swiss residents looking for nearby sunshine during foggy conditions.
- Walkers and hikers comparing hills, ridges, and viewpoints.
- Photographers looking for places above a sea of fog.

## Confirmed product direction

- Geographic focus: Switzerland.
- Use swisstopo maps as the map background.
- Add a subtle fog overlay that slightly obscures or dims relevant areas.
- Keep terrain, place names, and map details readable.
- Help users distinguish areas likely beneath the fog from areas likely above it.
- Keep the product focused on this single task.

The earlier preference for a small revenue-generating hobby project without subscriptions remains relevant. Exact pricing and whether use-based payment suits this product remain undecided. AI is not an established requirement for the fog map.

## Proposed first prototype — not yet confirmed

Start with an adjustable fog-height visualization to validate the map interaction independently of automatic weather prediction:

1. Display a swisstopo map for a selected Swiss region.
2. Let the user set an assumed fog-top altitude, expressed in metres above sea level.
3. Dim terrain below that altitude inside a clearly indicated coverage area.
4. Leave higher terrain visible and allow the overlay to be toggled for comparison.
5. Label the result as an altitude scenario, not observed fog coverage.

This prototype tests whether the visualization is useful. It does not fulfil the eventual automatic-weather use case by itself.

## Candidate automatic version

Estimate fog coverage and fog-top altitude by region and time, then combine those estimates with terrain elevations. Display the forecast validity time, source, freshness, and uncertainty.

Important distinctions:

- Terrain below a chosen altitude is not necessarily foggy.
- Fog extent and height can differ between neighbouring valleys.
- Terrain above the fog can still be cloudy or shaded.
- Detailed terrain boundaries do not make the underlying weather estimate equally precise.
- Missing or stale data must be distinguishable from a clear-weather result.

An automatic version needs a data feasibility and accuracy experiment before a production commitment.

## Proposed scope boundaries

For the first experiment, exclude full navigation, route generation, accounts, social features, nationwide webcam analysis, and AI-generated travel recommendations. These are scope proposals rather than approved exclusions.

## Technical context and dependencies

This brief is stored alongside the existing ProofreadAi workspace for convenience. ProofreadAi is a SwiftUI macOS/iOS app with a separate TypeScript backend; no decision has been made to reuse that architecture. The fog map is a separate product concept, and no application code has been created or changed for it.

Likely technical components:

- A map renderer supporting swisstopo layers and a custom translucent overlay.
- Terrain elevation data to derive an altitude mask.
- A weather-data pipeline if automatic estimates are pursued.
- Attribution and compliance with each data provider's usage conditions.

Existing research references, checked 28 October 2026:

- [swisstopo integration options](https://www.swisstopo.admin.ch/en/maps-and-geodata-in-your-app)
- [swisstopo open-data terms](https://www.swisstopo.admin.ch/de/nutzungsbedingungen-kostenlose-geodaten-und-geodienste)
- [MeteoSwiss open-data documentation](https://opendatadocs.meteoswiss.ch/)
- [MeteoSwiss forecast datasets](https://opendatadocs.meteoswiss.ch/e-forecast-data)

Map and weather-data availability do not establish that a ready-made, sufficiently accurate fog-top product is available. Dataset variables, distribution, processing costs, and suitability remain to be verified for implementation.

## Commercial hypothesis

Users might pay for an immediate, understandable view of terrain above the fog if it improves their outing decisions compared with free tools. Willingness to pay has not been established.

Use-based payment and a small one-time purchase are options to compare. A one-time sale must still fund ongoing weather processing and maintenance. Do not commit to lifetime live-weather service before estimating recurring costs.

## Validation before substantial development

- Test the overlay on real locations and fog situations with prospective users.
- Check whether users can identify useful areas more easily than with their current tools.
- For automatic estimates, compare predictions with time-matched observations at different elevations and in different regions.
- Record meaningful failures, particularly locations shown above fog that are actually within it.
- Test actual payment interest separately from enthusiasm for a demonstration.

## Open decisions

1. Platform: iPhone, web, or another starting point?
2. First release: manually adjustable altitude or automatic regional estimates?
3. Time scope: current conditions only or forecasts too?
4. Initial coverage: one region or all Switzerland?
5. Pricing: per use, one-time purchase, or another non-subscription approach?
6. What prediction error, uncertainty, and operating cost are acceptable?

## Current recommendation

Proceed with a narrow visualization prototype and an automatic-data feasibility check. A production build and pricing decision should follow evidence that the map is useful and the fog estimates are sufficiently reliable.
