# AIOStreams + AIOMetadata — Combined Repo

This repository combines two Stremio addon projects into one place, each running as its own service:

| Service | Port | Directory |
|---|---|---|
| **AIOStreams** (stream aggregator) | 3000 | `/` (root) |
| **AIOMetadata** (metadata provider) | 3232 | `/aiometadata/` |

## Quick Start

```bash
docker compose up -d
```

- AIOStreams configure UI → `http://localhost:3000`
- AIOMetadata configure UI → `http://localhost:3232`

## What was changed in AIOMetadata

The following were **removed** from the AIOMetadata configure UI because AIOStreams already handles them:

- **Art Providers** settings page (poster/background/logo source selection)
- **RPDB API Key** field in Integrations
- **TOP Posters API Key** field in Integrations
- `posterRatingProvider` and `usePosterProxy` config options

Everything else in AIOMetadata is untouched.

## Environment

Copy `.env.example` files for each service and edit as needed:

```bash
cp .env.sample .env                        # AIOStreams env
cp aiometadata/.env.example aiometadata/.env  # AIOMetadata env
```
