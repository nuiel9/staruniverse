# Star Universe is a static bundle — Vite emits dist/ and nothing on the server
# ever executes game code. So this is two stages: build the bundle with the
# toolchain, then throw the toolchain away and serve the files with nginx. The
# runtime image carries no Node, no node_modules and no source.
#
# The build stage needs the full dependency tree (Vite, rolldown, three), which
# is why `npm ci` runs without --omit=dev. None of it survives into the image
# that actually ships.

# ── build ─────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# Playwright's postinstall wants to download a browser. The acceptance suites
# run in CI and on a workstation, never inside this image, so the download is
# pure waste of build time and layer size.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Copy the manifests alone first, so a source-only change reuses the cached
# install layer instead of refetching the whole tree.
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# ── serve ─────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Cloud Run hands the port in $PORT and it is not always 8080. nginx has no
# environment-variable interpolation of its own, so the server block ships as a
# template: /etc/nginx/templates is this image's own entrypoint hook, and any
# .template in it is envsubst'd into /etc/nginx/conf.d before nginx starts.
# Only variables actually exported are substituted, so nginx's own $uri and
# $host survive untouched.
COPY nginx/conf.d/staruniverse.conf /etc/nginx/templates/default.conf.template
ENV PORT=8080

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
